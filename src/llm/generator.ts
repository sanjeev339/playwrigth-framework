import path from 'node:path';
import type { ReconSnapshot, Scenario } from '../types';
import { loadReconActions, type ReconAction } from '../recon/reconActionExtractor';
import {
  buildDeterministicReconTest,
  buildGeneratorPrompt,
  compactDropdownSnapshot,
  type CompactDropdownSnapshot
} from './generatorPromptBuilder';
import { listFiles, readJsonFile, readTextFile, resolveFromRoot, toSafeFileName, writeTextFile } from '../utils/fileUtils';
import { logger } from '../utils/logger';
import { normalizeNestedTestImports } from '../utils/specImportPaths';
import { normalizeGeneratedSelectMisuse, normalizeGeneratedWebsiteUrlUsage } from '../utils/generatedTestSanitizer';
import { callLLM } from './llmClient';
import { validateGeneratedReconTest } from './validateGeneratedReconTest';

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

  logger.info(`Generating tests for ${scenarioFiles.length} scenario(s) using LLM provider from env.`);

  for (const scenarioFile of scenarioFiles) {
    const scenario = await readJsonFile<Scenario>(scenarioFile);
    const safeScenarioId = toSafeFileName(scenario.scenario_id);
    const specPath = path.join(specDir, `${safeScenarioId}.md`);
    const reconPath = path.join(reconDir, safeScenarioId);
    const outputPath = path.join(outputDir, `${safeScenarioId}.spec.ts`);

    logger.info(`Generating test for ${scenario.scenario_id} (spec: ${path.basename(specPath)})...`);
    const plan = await readTextFile(specPath);
    const reconActions = await loadReconActions(scenario.scenario_id);

    if (reconActions.length === 0) {
      throw new Error(`No recon decisions found for ${scenario.scenario_id}. Run npm run recon first.`);
    }

    const dropdownSnapshots = await readRelevantDropdownSnapshots(reconPath, reconActions);
    const prompt = buildGeneratorPrompt({
      scenario,
      plan,
      reconActions,
      dropdownSnapshots
    });

    const code = await generateReconDrivenCode({
      scenario,
      reconActions,
      prompt
    });

    await writeTextFile(outputPath, code);
    validateGeneratedReconTest(code, scenario, reconActions);
    writtenFiles.push(outputPath);
    logger.info(`Wrote generated test for ${scenario.scenario_id} -> ${outputPath}`);
  }

  return writtenFiles;
}

async function generateReconDrivenCode(input: {
  scenario: Scenario;
  reconActions: ReconAction[];
  prompt: string;
}): Promise<string> {
  try {
    const generated = await callLLM(input.prompt);
    const llmCode = normalizeGeneratedSelectMisuse(
      normalizeGeneratedWebsiteUrlUsage(normalizeNestedTestImports(stripCodeFence(generated)))
    );
    validateGeneratedReconTest(llmCode, input.scenario, input.reconActions);
    return llmCode;
  } catch (error) {
    logger.warn(
      `LLM generated test did not satisfy recon-action validation. Falling back to deterministic recon generator. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const fallbackCode = buildDeterministicReconTest(input.scenario, input.reconActions);
  validateGeneratedReconTest(fallbackCode, input.scenario, input.reconActions);
  return fallbackCode;
}

async function readRelevantDropdownSnapshots(
  reconPath: string,
  reconActions: ReconAction[]
): Promise<CompactDropdownSnapshot[]> {
  const failedSelectSteps = new Set(
    reconActions
      .filter((action) => action.actionType === 'select' && action.actionStatus !== 'success')
      .map((action) => action.stepNo)
      .filter((stepNo): stepNo is number => stepNo !== undefined)
  );

  if (failedSelectSteps.size === 0) {
    return [];
  }

  const snapshots = await Promise.all((await listFiles(reconPath, '.json')).map((file) => readJsonFile<ReconSnapshot>(file)));
  return snapshots
    .filter((snapshot) => /dropdown-open/i.test(snapshot.state) && failedSelectSteps.has(snapshot.decision?.stepNo ?? -1))
    .map(compactDropdownSnapshot);
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
