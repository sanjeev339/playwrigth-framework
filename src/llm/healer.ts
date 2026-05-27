import path from 'node:path';
import fs from 'fs-extra';
import type { PlaywrightRunResult, ReconSnapshot, Scenario } from '../types';
import {
  listFiles,
  readJsonFile,
  readTextFile,
  resolveFromRoot,
  toSafeFileName,
  truncate,
  writeJsonFile,
  writeTextFile
} from '../utils/fileUtils';
import { logger } from '../utils/logger';
import { callLLM } from './openaiClient';

interface HealingResult {
  generated_at: string;
  status: 'skipped' | 'healed';
  healedFiles: string[];
  reason?: string;
}

export async function healFailedTests(options: {
  runResultPath?: string;
  scenarioDir?: string;
  generatedDir?: string;
  reconDir?: string;
  outputDir?: string;
  healingReportPath?: string;
} = {}): Promise<HealingResult> {
  const runResultPath = options.runResultPath ?? resolveFromRoot('reports', 'run-result.json');
  const scenarioDir = options.scenarioDir ?? resolveFromRoot('scenarios');
  const generatedDir = options.generatedDir ?? resolveFromRoot('tests', 'generated');
  const reconDir = options.reconDir ?? resolveFromRoot('recon');
  const outputDir = options.outputDir ?? resolveFromRoot('tests', 'healed');
  const healingReportPath = options.healingReportPath ?? resolveFromRoot('reports', 'healing-result.json');

  if (!(await fs.pathExists(runResultPath))) {
    const result = {
      generated_at: new Date().toISOString(),
      status: 'skipped' as const,
      healedFiles: [],
      reason: `Run result not found at ${runResultPath}`
    };
    await writeJsonFile(healingReportPath, result);
    return result;
  }

  const runResult = await readJsonFile<PlaywrightRunResult>(runResultPath);
  if (runResult.status !== 'failed') {
    const result = {
      generated_at: new Date().toISOString(),
      status: 'skipped' as const,
      healedFiles: [],
      reason: 'Generated test run passed; healing not needed.'
    };
    await writeJsonFile(healingReportPath, result);
    logger.info('Healing skipped because generated tests passed.');
    return result;
  }

  const generatedFiles = await filesToHeal(generatedDir, runResult.failedTestFiles);
  const healedFiles: string[] = [];

  for (const generatedFile of generatedFiles) {
    const scenarioId = path.basename(generatedFile).replace(/\.spec\.ts$/, '');
    const scenarioPath = path.join(scenarioDir, `${scenarioId}.json`);
    const scenario = (await fs.pathExists(scenarioPath)) ? await readJsonFile<Scenario>(scenarioPath) : undefined;
    const snapshots = await readReconSnapshots(path.join(reconDir, scenarioId));
    const generatedCode = await readTextFile(generatedFile);
    const prompt = buildHealerPrompt(generatedCode, runResult, snapshots, scenario);
    const healedCode = stripCodeFence(await callLLM(prompt));
    const healedPath = path.join(outputDir, `${toSafeFileName(scenarioId)}.spec.ts`);
    await writeTextFile(healedPath, healedCode);
    healedFiles.push(healedPath);
    logger.info(`Wrote healed test -> ${healedPath}`);
  }

  const result: HealingResult = {
    generated_at: new Date().toISOString(),
    status: 'healed',
    healedFiles
  };
  await writeJsonFile(healingReportPath, result);
  return result;
}

async function filesToHeal(generatedDir: string, failedTestFiles: string[]): Promise<string[]> {
  if (failedTestFiles.length === 0) {
    return listFiles(generatedDir, '.ts');
  }

  return failedTestFiles.map((file) => path.resolve(process.cwd(), file)).filter((file) => fs.existsSync(file));
}

async function readReconSnapshots(reconPath: string): Promise<ReconSnapshot[]> {
  const files = await listFiles(reconPath, '.json');
  return Promise.all(files.map((file) => readJsonFile<ReconSnapshot>(file)));
}

function buildHealerPrompt(
  generatedCode: string,
  runResult: PlaywrightRunResult,
  snapshots: ReconSnapshot[],
  scenario?: Scenario
): string {
  const compactSnapshots = snapshots.map((snapshot) => ({
    state: snapshot.state,
    url: snapshot.url,
    action_error: snapshot.action_error,
    elements: snapshot.elements.map((element) => ({
      text: element.text,
      role: element.role,
      label: element.label,
      placeholder: element.placeholder,
      suggestedLocator: element.suggestedLocator,
      locatorPriority: element.locatorPriority
    }))
  }));

  return truncate(
    [
      'Repair the Playwright TypeScript test below.',
      '',
      'Rules:',
      '- Fix only locator, wait, and assertion issues.',
      '- Do not change business flow.',
      '- Do not change test data.',
      '- Do not hardcode credentials.',
      '- Prefer recon locator candidates.',
      '- Fix strict mode violations by scoping locators.',
      '- Fix missing waits using Playwright auto-waiting patterns or expect.',
      '- Output code only, no Markdown fence.',
      '',
      'Scenario:',
      scenario ? JSON.stringify(scenario, null, 2) : 'Scenario file unavailable.',
      '',
      'Run stdout:',
      truncate(runResult.stdout, 16_000),
      '',
      'Run stderr:',
      truncate(runResult.stderr, 16_000),
      '',
      'Recon snapshots:',
      JSON.stringify(compactSnapshots, null, 2),
      '',
      'Generated test code:',
      generatedCode
    ].join('\n'),
    120_000
  );
}

function stripCodeFence(value: string): string {
  return value.replace(/^```(?:typescript|ts)?\s*/i, '').replace(/```\s*$/i, '').trimEnd() + '\n';
}

if (require.main === module) {
  healFailedTests()
    .then((result) => {
      logger.info(`Healing ${result.status}. Healed files: ${result.healedFiles.length}`);
    })
    .catch((error) => {
      logger.error('Healing failed.', error);
      process.exitCode = 1;
    });
}
