import path from 'node:path';
import type { ReconSnapshot, Scenario } from '../types';
import {
  listFiles,
  readJsonFile,
  readTextFile,
  resolveFromRoot,
  toSafeFileName,
  truncate,
  writeTextFile
} from '../utils/fileUtils';
import { logger } from '../utils/logger';
import { callLLM } from './openaiClient';

export async function generateTests(options: {
  scenarioDir?: string;
  specDir?: string;
  reconDir?: string;
  outputDir?: string;
} = {}): Promise<string[]> {
  const scenarioDir = options.scenarioDir ?? resolveFromRoot('scenarios');
  const specDir = options.specDir ?? resolveFromRoot('specs');
  const reconDir = options.reconDir ?? resolveFromRoot('recon');
  const outputDir = options.outputDir ?? resolveFromRoot('tests', 'generated');
  const scenarioFiles = await listFiles(scenarioDir, '.json');
  const writtenFiles: string[] = [];

  if (scenarioFiles.length === 0) {
    throw new Error(`No scenario files found in ${scenarioDir}. Run npm run build:scenarios first.`);
  }

  for (const scenarioFile of scenarioFiles) {
    const scenario = await readJsonFile<Scenario>(scenarioFile);
    const safeScenarioId = toSafeFileName(scenario.scenario_id);
    const specPath = path.join(specDir, `${safeScenarioId}.md`);
    const reconPath = path.join(reconDir, safeScenarioId);
    const plan = await readTextFile(specPath);
    const snapshots = await readReconSnapshots(reconPath);
    const prompt = buildGeneratorPrompt(scenario, plan, snapshots);
    const generated = await callLLM(prompt);
    const code = stripCodeFence(generated);
    const outputPath = path.join(outputDir, `${safeScenarioId}.spec.ts`);
    await writeTextFile(outputPath, code);
    writtenFiles.push(outputPath);
    logger.info(`Wrote generated test for ${scenario.scenario_id} -> ${outputPath}`);
  }

  return writtenFiles;
}

async function readReconSnapshots(reconPath: string): Promise<ReconSnapshot[]> {
  const files = await listFiles(reconPath, '.json');
  return Promise.all(files.map((file) => readJsonFile<ReconSnapshot>(file)));
}

function buildGeneratorPrompt(scenario: Scenario, plan: string, snapshots: ReconSnapshot[]): string {
  const compactSnapshots = snapshots.map((snapshot) => ({
    scenario_id: snapshot.scenario_id,
    state: snapshot.state,
    url: snapshot.url,
    action_before_snapshot: snapshot.action_before_snapshot,
    action_error: snapshot.action_error,
    elements: snapshot.elements.map((element) => ({
      tag: element.tag,
      type: element.type,
      text: element.text,
      role: element.role,
      ariaLabel: element.ariaLabel,
      label: element.label,
      placeholder: element.placeholder,
      suggestedLocator: element.suggestedLocator,
      locatorPriority: element.locatorPriority
    }))
  }));

  return truncate(
    [
      'Generate a runnable Playwright TypeScript test for this scenario.',
      '',
      'Rules:',
      '- Use @playwright/test.',
      '- Use TypeScript.',
      '- Use test.step.',
      '- Use process.env.WEBSITE_URL.',
      '- Use process.env.LOGIN_EMAIL.',
      '- Use process.env.LOGIN_PASSWORD.',
      '- Never hardcode login credentials.',
      '- Use payload values for business data.',
      '- Prefer locators from recon snapshot suggestedLocator and locatorPriority.',
      '- Prefer getByRole, getByLabel, and getByPlaceholder.',
      '- Avoid XPath unless no stable locator exists.',
      '- Add assertions from test plan.',
      '- Do not add unsupported libraries.',
      '- Output code only, no Markdown fence.',
      '',
      'Scenario JSON:',
      JSON.stringify(scenario, null, 2),
      '',
      'Markdown test plan:',
      plan,
      '',
      'Recon snapshots:',
      JSON.stringify(compactSnapshots, null, 2)
    ].join('\n'),
    120_000
  );
}

function stripCodeFence(value: string): string {
  return value.replace(/^```(?:typescript|ts)?\s*/i, '').replace(/```\s*$/i, '').trimEnd() + '\n';
}

if (require.main === module) {
  generateTests()
    .then((files) => {
      logger.info(`Generated ${files.length} Playwright test file(s).`);
    })
    .catch((error) => {
      logger.error('Test generation failed.', error);
      process.exitCode = 1;
    });
}
