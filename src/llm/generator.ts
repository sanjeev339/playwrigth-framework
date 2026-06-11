import path from 'node:path';
import fs from 'fs-extra';
import { getFrameworkPaths } from '../config/env';
import type {
  GenerationFailureStage,
  GenerationReport,
  GenerationScenarioResult,
  ReconSnapshot,
  Scenario
} from '../types';
import { extractReconActions, type ReconAction } from '../recon/reconActionExtractor';
import {
  buildDeterministicReconTest,
  buildGeneratorPrompt,
  compactDropdownSnapshot,
  type CompactDropdownSnapshot
} from './generatorPromptBuilder';
import {
  listFiles,
  readJsonFile,
  readTextFile,
  toSafeFileName,
  writeJsonFile,
  writeTextFileAtomic
} from '../utils/fileUtils';
import { logger } from '../utils/logger';
import { normalizeNestedTestImports } from '../utils/specImportPaths';
import { callLLM } from './llmClient';

interface GeneratedCode {
  code: string;
  source: 'llm' | 'deterministic';
}

export interface GenerateTestsOptions {
  scenarioDir?: string;
  dynamicReconDir?: string;
  outputDir?: string;
  quarantineDir?: string;
  reportPath?: string;
  dependencies?: {
    callLLM?: typeof callLLM;
    extractReconActions?: typeof extractReconActions;
    now?: () => Date;
  };
}

class ScenarioGenerationError extends Error {
  constructor(
    readonly stage: GenerationFailureStage,
    cause: unknown
  ) {
    super(errorMessage(cause));
    this.name = 'ScenarioGenerationError';
  }
}

export async function generateTests(options: GenerateTestsOptions = {}): Promise<GenerationReport> {
  const paths = getFrameworkPaths();
  const scenarioDir = options.scenarioDir ?? paths.scenarioDir;
  const dynamicReconDir = options.dynamicReconDir ?? paths.dynamicReconDir;
  const outputDir = options.outputDir ?? paths.generatedTestsDir;
  const quarantineDir = options.quarantineDir ?? paths.generatedTestsQuarantineDir;
  const reportPath = options.reportPath ?? paths.generationReportPath;
  const extractActions = options.dependencies?.extractReconActions ?? extractReconActions;
  const callLLMForGeneration = options.dependencies?.callLLM ?? callLLM;
  const now = options.dependencies?.now ?? (() => new Date());
  const scenarioFiles = await listFiles(scenarioDir, '.json');

  if (scenarioFiles.length === 0) {
    throw new Error(`No scenario files found in ${scenarioDir}. Run npm run build:scenarios first.`);
  }

  logger.info(`Generating tests for ${scenarioFiles.length} scenario(s) using LLM provider from env.`);
  const scenarioResults: GenerationScenarioResult[] = [];

  for (const scenarioFile of scenarioFiles) {
    scenarioResults.push(
      await generateScenarioIndependently({
        scenarioFile,
        dynamicReconDir,
        outputDir,
        quarantineDir,
        extractActions,
        callLLMForGeneration,
        now
      })
    );
  }

  const report: GenerationReport = {
    generated_at: now().toISOString(),
    summary: {
      total: scenarioResults.length,
      generated: scenarioResults.filter((scenario) => scenario.status === 'generated').length,
      failed: scenarioResults.filter((scenario) => scenario.status === 'failed').length
    },
    scenarios: scenarioResults
  };

  await writeJsonFile(reportPath, report);
  logger.info(
    `Wrote generation report -> ${reportPath} (${report.summary.generated} generated, ${report.summary.failed} failed).`
  );
  return report;
}

async function generateScenarioIndependently(input: {
  scenarioFile: string;
  dynamicReconDir: string;
  outputDir: string;
  quarantineDir: string;
  extractActions: typeof extractReconActions;
  callLLMForGeneration: typeof callLLM;
  now: () => Date;
}): Promise<GenerationScenarioResult> {
  let stage: GenerationFailureStage = 'scenario-read';
  let scenarioId = path.basename(input.scenarioFile, path.extname(input.scenarioFile));
  let safeScenarioId = toSafeFileName(scenarioId);
  let outputPath = path.join(input.outputDir, `${safeScenarioId}.spec.ts`);
  let reconSource: 'dynamic' | 'static' | undefined;

  try {
    const scenario = await readJsonFile<Scenario>(input.scenarioFile);
    scenarioId = scenario.scenario_id;
    safeScenarioId = toSafeFileName(scenarioId);
    outputPath = path.join(input.outputDir, `${safeScenarioId}.spec.ts`);
    logger.info(`Generating test for ${scenarioId} using recon-only mode...`);

    stage = 'recon-extraction';
    const reconActions = await input.extractActions(scenarioId, input.dynamicReconDir);
    reconSource = 'dynamic';
    logger.info(`Loaded ${reconActions.length} dynamic recon action(s) for ${scenarioId}.`);
    if (reconActions.length === 0) {
      throw new Error(`No recon decisions found for ${scenarioId}. Run npm run pipeline first.`);
    }

    const reconPath = path.join(input.dynamicReconDir, safeScenarioId);
    const dropdownSnapshots = await readRelevantDropdownSnapshots(reconPath, reconActions);
    stage = 'prompt-build';
    const prompt = buildGeneratorPrompt({
      scenario,
      reconActions,
      dropdownSnapshots
    });

    const generated = await generateReconDrivenCode({
      scenario,
      reconActions,
      prompt,
      callLLMForGeneration: input.callLLMForGeneration
    });
    const code = normalizeNestedTestImports(generated.code);

    stage = 'validation';
    validateGeneratedReconTest(code, scenario, reconActions);

    stage = 'write';
    await writeTextFileAtomic(outputPath, code);
    logger.info(`Wrote generated test for ${scenarioId} -> ${outputPath}`);
    return {
      scenario_id: scenarioId,
      status: 'generated',
      generated_file: path.relative(process.cwd(), outputPath),
      generator_source: generated.source,
      recon_source: reconSource
    };
  } catch (error) {
    let failureStage = error instanceof ScenarioGenerationError ? error.stage : stage;
    let failureMessage = errorMessage(error);
    let quarantinedFile: string | undefined;

    try {
      quarantinedFile = await quarantineGeneratedTest(outputPath, input.quarantineDir, safeScenarioId, input.now);
    } catch (quarantineError) {
      failureStage = 'quarantine';
      failureMessage = `${failureMessage} Quarantine failed: ${errorMessage(quarantineError)}`;
    }

    logger.error(`Test generation failed for ${scenarioId} at ${failureStage}; continuing with remaining scenarios.`, error);
    return {
      scenario_id: scenarioId,
      status: 'failed',
      failed_stage: failureStage,
      error: failureMessage,
      recon_source: reconSource,
      quarantined_file: quarantinedFile
    };
  }
}

async function generateReconDrivenCode(input: {
  scenario: Scenario;
  reconActions: ReconAction[];
  prompt: string;
  callLLMForGeneration: typeof callLLM;
}): Promise<GeneratedCode> {
  try {
    const generated = await input.callLLMForGeneration(input.prompt, 'generator');
    const llmCode = stripCodeFence(generated);
    validateGeneratedReconTest(llmCode, input.scenario, input.reconActions);
    return { code: llmCode, source: 'llm' };
  } catch (error) {
    logger.warn(
      `LLM generated test did not satisfy recon-action validation. Falling back to deterministic recon generator. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  try {
    const fallbackCode = buildDeterministicReconTest(input.scenario, input.reconActions);
    validateGeneratedReconTest(fallbackCode, input.scenario, input.reconActions);
    return { code: fallbackCode, source: 'deterministic' };
  } catch (error) {
    throw new ScenarioGenerationError('deterministic-generation', error);
  }
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

function validateGeneratedReconTest(code: string, scenario: Scenario, reconActions: ReconAction[]): void {
  const normalizedCode = code.toLowerCase();

  for (const action of reconActions) {
    if (action.stepNo === undefined) {
      continue;
    }

    const stepMarker = `Step ${action.stepNo}: ${action.rawStep}`;
    if (!code.includes(stepMarker)) {
      throw new Error(`Generated test missing required recon action: Step ${action.stepNo} - ${action.rawStep}`);
    }

    const target = action.target?.trim();
    if (target && target !== '__FORM__' && !normalizedCode.includes(target.toLowerCase())) {
      throw new Error(`Generated test missing required recon target: Step ${action.stepNo} - ${target}`);
    }

    if (
      action.actionStatus === 'success' &&
      action.selectedLocator &&
      action.actionType !== 'select' &&
      !code.includes(action.selectedLocator)
    ) {
      throw new Error(`Generated test missing required recon locator: Step ${action.stepNo} - ${action.rawStep}`);
    }
  }

  validateActionPayloadReferences(code, reconActions, scenario.payload);

  if (/selectOption\s*\(/.test(code)) {
    throw new Error('Generated test must not use selectOption for custom dropdowns.');
  }

  if (code.includes('${baseURL}/login/') || code.includes('/login/login')) {
    throw new Error('Generated test must not append /login/ manually or create /login/login URLs.');
  }
}

function validateActionPayloadReferences(code: string, reconActions: ReconAction[], payload: Record<string, unknown>): void {
  for (const action of reconActions) {
    const value = action.selectedValue ?? action.value;
    if (!value || !['fill', 'select'].includes(action.actionType)) {
      continue;
    }

    const payloadKey = Object.keys(payload).find((key) => String(payload[key]) === String(value));
    if (!payloadKey || /password|secret|token|jwt|cookie|authorization|api[_-]?key/i.test(payloadKey)) {
      continue;
    }

    if (!code.includes(String(value)) && !code.includes(`payload[${JSON.stringify(payloadKey)}]`)) {
      throw new Error(`Generated test missing payload value or payload reference: Step ${action.stepNo ?? '?'} - ${payloadKey}`);
    }
  }
}

function stripCodeFence(value: string): string {
  return value.replace(/^```(?:typescript|ts)?\s*/i, '').replace(/```\s*$/i, '').trimEnd() + '\n';
}

async function quarantineGeneratedTest(
  generatedFile: string,
  quarantineRoot: string,
  safeScenarioId: string,
  now: () => Date
): Promise<string | undefined> {
  if (!(await fs.pathExists(generatedFile))) {
    return undefined;
  }

  const timestamp = now().toISOString().replace(/[^0-9A-Za-z.-]+/g, '-');
  const quarantinePath = path.join(quarantineRoot, safeScenarioId, `${timestamp}-${path.basename(generatedFile)}`);
  await fs.ensureDir(path.dirname(quarantinePath));
  await fs.move(generatedFile, quarantinePath, { overwrite: true });
  logger.warn(`Quarantined stale generated test for ${safeScenarioId} -> ${quarantinePath}`);
  return path.relative(process.cwd(), quarantinePath);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (require.main === module) {
  generateTests()
    .then((report) => {
      logger.info(`Generated ${report.summary.generated} Playwright test file(s).`);
      if (report.summary.generated === 0) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      logger.error('Test generation failed.', error);
      process.exitCode = 1;
    });
}
