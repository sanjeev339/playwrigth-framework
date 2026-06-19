import path from 'node:path';
import { chromium, type Locator, type Page } from '@playwright/test';
import fs from 'fs-extra';
import { getFrameworkPaths, getWebEnv } from '../config/env';
import { readTestData } from '../input/jsonReader';
import { decideAndExecuteAction } from '../recon/actionDecisionEngine';
import { locatorFromExpression } from '../recon/locatorSafetyValidator';
import { scanVisibleDom } from '../recon/domScanner';
import { waitForRafCycles, waitForSnapshotStability } from '../recon/pageStabilizer';
import { extractReconActions } from '../recon/reconActionExtractor';
import { performLogin, safeAction, gotoWithRetry } from '../utils/playwrightUtils';
import type { ReconDecision } from '../recon/reconDecisionTypes';
import { writeStateSnapshot } from '../recon/stateSnapshotWriter';
import type { ReconSnapshot, Scenario, ScenarioStep, FrontendStepIssue } from '../types';
import {
  escapeHtml,
  listFiles,
  readJsonFile,
  slugify,
  toSafeFileName,
  writeJsonFile,
  writeTextFile
} from '../utils/fileUtils';
import { logger } from '../utils/logger';
import { writeCombinedFrontendReport } from '../reports/frontendReviewReporter';
import { writeReviewerReport } from '../reports/reviewerReportWriter';
import { getFrameworkConfig } from '../config/configLoader';
import { runWithConcurrency } from '../utils/concurrencyUtils';

type StepExecutionStatus = 'passed' | 'failed' | 'repaired' | 'skipped';
type ScenarioExecutionStatus = 'passed' | 'failed';

interface SnapshotReference {
  state: string;
  path: string;
}

export interface EffectVerification {
  status: 'passed' | 'failed' | 'skipped';
  reason: string;
}

export interface StepExecutionReport {
  stepNo: number;
  instruction: string;
  expectedResult?: string;
  status: StepExecutionStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  beforeSnapshotPath?: string;
  afterSnapshotPath?: string;
  beforeUrl?: string;
  afterUrl?: string;
  repairBeforeSnapshotPath?: string;
  repairAfterSnapshotPath?: string;
  screenshotPath?: string;
  repairScreenshotPath?: string;
  failureReason?: string;
  repairAttempted: boolean;
  repairSucceeded: boolean;
  verification: EffectVerification;
  repairVerification?: EffectVerification;
  decision: DecisionSummary;
  repairDecision?: DecisionSummary;
}

export interface DecisionSummary {
  decisionSource: ReconDecision['decisionSource'];
  actionStatus: ReconDecision['actionStatus'];
  selectedLocator: string | null;
  selectedValue: string | null;
  confidence?: ReconDecision['confidence'];
  selectorRisk?: ReconDecision['selectorRisk'];
  llmReason?: string;
  actionError?: string | null;
  executed: boolean;
  llmUsed: boolean;
  llmPromptTokenEstimate?: number;
  llmResponseTokenEstimate?: number;
  llmTotalTokenEstimate?: number;
  actionType?: string;
}

export interface ScenarioExecutionReport {
  scenarioId: string;
  module?: string;
  action?: string;
  status: ScenarioExecutionStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  loginStatus: 'passed' | 'failed';
  loginError?: string;
  stoppedAtStep?: number;
  failureReason?: string;
  snapshotSessionId: string;
  snapshots: SnapshotReference[];
  steps: StepExecutionReport[];
}

export interface DynamicRunReport {
  generatedAt: string;
  command: string;
  mode: 'hybrid-webwright-step-runner';
  summary: {
    total: number;
    passed: number;
    failed: number;
    totalSteps: number;
    passedSteps: number;
    failedSteps: number;
    repairedSteps: number;
    llmDecisionCount: number;
    estimatedLlmTokens: number;
  };
  scenarios: ScenarioExecutionReport[];
}

interface CapturedSnapshot {
  filePath: string;
  snapshot: ReconSnapshot;
}

interface DynamicRunnerOptions {
  scenarioDir?: string;
  outputDir?: string;
  reportJsonPath?: string;
  reportHtmlPath?: string;
}

export async function runDynamicScenarios(options: DynamicRunnerOptions = {}): Promise<DynamicRunReport> {
  process.env['IS_RECON'] = 'true';
  const env = getWebEnv();
  const paths = getFrameworkPaths();
  const scenarioDir = options.scenarioDir ?? paths.scenarioDir;
  const outputDir = options.outputDir ?? paths.dynamicReconDir;
  const reportJsonPath = options.reportJsonPath ?? paths.dynamicReportJsonPath;
  const reportHtmlPath = options.reportHtmlPath ?? paths.dynamicReportHtmlPath;
  const scenarioFiles = await listFiles(scenarioDir, '.json');

  if (scenarioFiles.length === 0) {
    throw new Error(`No normalized scenario JSON files found in ${scenarioDir}. Run npm run build:scenarios first.`);
  }

  const scenarios = (
    await Promise.all(scenarioFiles.map((scenarioFile) => readJsonFile<Scenario>(scenarioFile)))
  ).sort((left, right) => (left.metadata.execution_order ?? 0) - (right.metadata.execution_order ?? 0));
  const runtimePayloads = await loadRuntimePayloads(paths.inputDataPath);

  await fs.emptyDir(outputDir);

  const browser = await chromium.launch({
    headless: env.HEADLESS,
    slowMo: env.SLOW_MO
  });
  const reports: ScenarioExecutionReport[] = [];
  const frontendIssues: Record<string, FrontendStepIssue[]> = {};

  const config = getFrameworkConfig();

  try {
    for (const scenario of scenarios) {
      const runtimePayload = runtimePayloads.get(scenario.scenario_id);
      const scenarioIssues: FrontendStepIssue[] = [];
      const localRegister = (issues: FrontendStepIssue[]) => {
        for (const newIssue of issues) {
          const isDup = scenarioIssues.some(
            existing => existing.stepNo === newIssue.stepNo &&
              JSON.stringify(existing.issueCodes) === JSON.stringify(newIssue.issueCodes)
          );
          if (!isDup) {
            scenarioIssues.push(newIssue);
          }
        }
      };

      const scenarioReport = await runScenario({
        scenario: runtimePayload ? { ...scenario, payload: { ...scenario.payload, ...runtimePayload } } : scenario,
        outputDir,
        env,
        onFrontendIssue: localRegister
      });

      reports.push(scenarioReport);
      frontendIssues[scenario.scenario_id] = scenarioIssues;
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  async function runScenario(input: {
    scenario: Scenario;
    outputDir: string;
    env: ReturnType<typeof getWebEnv>;
    onFrontendIssue?: (issues: FrontendStepIssue[]) => void;
  }): Promise<ScenarioExecutionReport> {
    const startedAt = new Date();
    const scenario = input.scenario;
    const safeScenarioId = toSafeFileName(scenario.scenario_id);
    const scenarioOutputDir = path.join(input.outputDir, safeScenarioId);
    const screenshotDir = path.join(scenarioOutputDir, 'screenshots');
    const snapshotSessionId = `${safeScenarioId}-${Date.now()}`;
    const snapshots: SnapshotReference[] = [];
    const steps: StepExecutionReport[] = [];
    const previousActionErrors: string[] = [];
    let sequence = 1;
    let stoppedAtStep: number | undefined;
    let failureReason: string | undefined;
    let loginStatus: 'passed' | 'failed' = 'passed';
    let loginError: string | undefined;

    await fs.emptyDir(scenarioOutputDir);
    await fs.ensureDir(screenshotDir);

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await gotoWithRetry(page, input.env.WEBSITE_URL);
      await recordSnapshot(
        await captureSnapshot({
          page,
          scenarioId: scenario.scenario_id,
          scenarioDir: scenarioOutputDir,
          sequence: sequence++,
          state: 'login-before',
          actionBeforeSnapshot: scenario.skip_login ? 'Open page (no login required)' : 'Open login page',
          decision: null,
          actionError: null,
          snapshotSessionId
        }),
        snapshots
      );

      if (!scenario.skip_login) {
        loginError = await safeAction(() => performLogin(page, input.env.LOGIN_EMAIL, input.env.LOGIN_PASSWORD, waitForSnapshotStability)) ?? undefined;
        loginStatus = loginError ? 'failed' : 'passed';
        await recordSnapshot(
          await captureSnapshot({
            page,
            scenarioId: scenario.scenario_id,
            scenarioDir: scenarioOutputDir,
            sequence: sequence++,
            state: 'login-after',
            actionBeforeSnapshot: 'Perform login',
            decision: null,
            actionError: loginError ?? null,
            snapshotSessionId
          }),
          snapshots
        );
      }

      if (loginError) {
        failureReason = `Login failed: ${loginError}`;
        await captureFailureScreenshot(page, screenshotDir, 'login-failed');
      } else {
        for (let i = 0; i < scenario.steps.length; i++) {
          const step = scenario.steps[i];
          const isLastStep = i === scenario.steps.length - 1;
          const stepReport = await executeStep({
            page,
            scenario,
            step,
            scenarioOutputDir,
            screenshotDir,
            snapshotSessionId,
            previousActionErrors,
            isLastStep,
            nextSequence: () => sequence++,
            onFrontendIssue: input.onFrontendIssue
          });
          steps.push(stepReport);
          snapshots.push(...extractStepSnapshots(stepReport));

          if (stepReport.status === 'failed') {
            stoppedAtStep = stepReport.stepNo;
            failureReason = stepReport.failureReason;
            break;
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failureReason = `Scenario runner failed before completion: ${message}`;
      loginStatus = loginStatus === 'passed' && steps.length === 0 ? 'failed' : loginStatus;
      loginError = steps.length === 0 ? message : loginError;
      await captureFailureScreenshot(page, screenshotDir, 'scenario-runner-failed').catch(() => undefined);
    } finally {
      await context.close().catch(() => undefined);
    }

    const endedAt = new Date();
    return {
      scenarioId: scenario.scenario_id,
      module: scenario.module,
      action: scenario.action,
      status: failureReason ? 'failed' : 'passed',
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      loginStatus,
      loginError,
      stoppedAtStep,
      failureReason,
      snapshotSessionId,
      snapshots,
      steps
    };
  }

  const report = createRunReport(reports);
  await writeJsonFile(reportJsonPath, report);
  await writeTextFile(reportHtmlPath, renderDynamicReport(report));
  logger.info(`Wrote dynamic step-runner reports -> ${reportJsonPath}, ${reportHtmlPath}`);

  const runTimestamp = formatTimestamp(new Date());

  // Write frontend review report
  await fs.ensureDir(paths.frontendReviewDir);
  const writtenPath = await writeCombinedFrontendReport(frontendIssues, runTimestamp, paths.frontendReviewDir);
  logger.info(`Wrote combined frontend review report to -> ${writtenPath}`);

  // Write reviewer report
  try {
    const reviewerReportPath = await writeReviewerReport(reports, frontendIssues, runTimestamp, paths.documentReportDir);
    logger.info(`Wrote Reviewer Report to -> ${reviewerReportPath}`);
  } catch (error) {
    logger.error('Error generating Reviewer Report:', error);
  }

  // Extract recon action summaries from dynamic-recon snapshots so the
  // .spec.ts generator can find them under recon-summary/ and use them
  // as 'dynamic' source (preferred over static recon).
  logger.info('Extracting recon action summaries for generator...');
  for (const scenario of scenarios) {
    try {
      const actions = await extractReconActions(scenario.scenario_id, outputDir);
      logger.info(`  [recon-summary] ${scenario.scenario_id}: ${actions.length} action(s) ready for generator.`);
    } catch (error) {
      logger.warn(`  [recon-summary] Could not extract actions for ${scenario.scenario_id}.`, error);
    }
  }

  return report;
}

async function executeStep(input: {
  page: Page;
  scenario: Scenario;
  step: ScenarioStep;
  scenarioOutputDir: string;
  screenshotDir: string;
  snapshotSessionId: string;
  previousActionErrors: string[];
  isLastStep: boolean;
  nextSequence: () => number;
  onFrontendIssue?: (issues: FrontendStepIssue[]) => void;
}): Promise<StepExecutionReport> {
  const startedAt = new Date();
  const stepNo = input.step.step_no ?? 0;
  const before = await captureSnapshot({
    page: input.page,
    scenarioId: input.scenario.scenario_id,
    scenarioDir: input.scenarioOutputDir,
    sequence: input.nextSequence(),
    state: `step-${stepNo}-before`,
    actionBeforeSnapshot: input.step.instruction,
    decision: null,
    actionError: null,
    snapshotSessionId: input.snapshotSessionId
  });

  const decision = await decideAndExecuteAction({
    page: input.page,
    scenarioId: input.scenario.scenario_id,
    step: input.step,
    payload: input.scenario.payload,
    snapshotElements: before.snapshot.elements,
    previousActionErrors: input.previousActionErrors,
    isLastStep: input.isLastStep,
    onIntermediateSnapshot: async (state: string, actionBeforeSnapshot: string, intermediateDecision: ReconDecision) => {
      await captureSnapshot({
        page: input.page,
        scenarioId: input.scenario.scenario_id,
        scenarioDir: input.scenarioOutputDir,
        sequence: input.nextSequence(),
        state,
        actionBeforeSnapshot,
        decision: intermediateDecision,
        actionError: intermediateDecision.actionError ?? null,
        snapshotSessionId: input.snapshotSessionId
      });
    },
    onFrontendIssue: input.onFrontendIssue
  });

  const after = await captureSnapshot({
    page: input.page,
    scenarioId: input.scenario.scenario_id,
    scenarioDir: input.scenarioOutputDir,
    sequence: input.nextSequence(),
    state: `step-${stepNo}-after`,
    actionBeforeSnapshot: input.step.instruction,
    decision,
    actionError: decision.actionError ?? null,
    snapshotSessionId: input.snapshotSessionId
  });
  const verification = await verifyActionEffect(input.page, before.snapshot, after.snapshot, decision);

  if (isPassingStep(decision, verification)) {
    const endedAt = new Date();
    return {
      stepNo,
      instruction: input.step.instruction,
      expectedResult: input.step.expected_result,
      status: 'passed',
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      beforeSnapshotPath: before.filePath,
      afterSnapshotPath: after.filePath,
      beforeUrl: before.snapshot.url,
      afterUrl: after.snapshot.url,
      repairAttempted: false,
      repairSucceeded: false,
      verification,
      decision: summarizeDecision(decision)
    };
  }

  const firstFailureReason = failureReasonFor(decision, verification);
  input.previousActionErrors.push(`step ${stepNo}: ${firstFailureReason}`);
  const screenshotPath = await captureFailureScreenshot(input.page, input.screenshotDir, `step-${stepNo}-failed`);

  const repairBefore = await captureSnapshot({
    page: input.page,
    scenarioId: input.scenario.scenario_id,
    scenarioDir: input.scenarioOutputDir,
    sequence: input.nextSequence(),
    state: `step-${stepNo}-repair-before`,
    actionBeforeSnapshot: `Repair attempt for: ${input.step.instruction}`,
    decision,
    actionError: firstFailureReason,
    snapshotSessionId: input.snapshotSessionId
  });

  const repairDecision = await decideAndExecuteAction({
    page: input.page,
    scenarioId: input.scenario.scenario_id,
    step: input.step,
    payload: input.scenario.payload,
    snapshotElements: repairBefore.snapshot.elements,
    previousActionErrors: input.previousActionErrors,
    isLastStep: input.isLastStep,
    onFrontendIssue: input.onFrontendIssue
  });
  const repairAfter = await captureSnapshot({
    page: input.page,
    scenarioId: input.scenario.scenario_id,
    scenarioDir: input.scenarioOutputDir,
    sequence: input.nextSequence(),
    state: `step-${stepNo}-repair-after`,
    actionBeforeSnapshot: `Repair attempt for: ${input.step.instruction}`,
    decision: repairDecision,
    actionError: repairDecision.actionError ?? null,
    snapshotSessionId: input.snapshotSessionId
  });
  const repairVerification = await verifyActionEffect(input.page, repairBefore.snapshot, repairAfter.snapshot, repairDecision);
  const repairSucceeded = repairDecision.actionStatus === 'success' && repairVerification.status !== 'failed';
  const repairFailureReason = repairSucceeded ? undefined : failureReasonFor(repairDecision, repairVerification);
  const repairScreenshotPath = repairSucceeded
    ? undefined
    : await captureFailureScreenshot(input.page, input.screenshotDir, `step-${stepNo}-repair-failed`);
  const endedAt = new Date();

  return {
    stepNo,
    instruction: input.step.instruction,
    expectedResult: input.step.expected_result,
    status: repairSucceeded ? 'repaired' : 'failed',
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    beforeSnapshotPath: before.filePath,
    afterSnapshotPath: after.filePath,
    beforeUrl: before.snapshot.url,
    afterUrl: after.snapshot.url,
    repairBeforeSnapshotPath: repairBefore.filePath,
    repairAfterSnapshotPath: repairAfter.filePath,
    screenshotPath,
    repairScreenshotPath,
    failureReason: repairFailureReason ?? firstFailureReason,
    repairAttempted: true,
    repairSucceeded,
    verification,
    repairVerification,
    decision: summarizeDecision(decision),
    repairDecision: summarizeDecision(repairDecision)
  };
}

async function captureSnapshot(input: {
  page: Page;
  scenarioId: string;
  scenarioDir: string;
  sequence: number;
  state: string;
  actionBeforeSnapshot: string;
  decision: ReconDecision | null;
  actionError: string | null;
  snapshotSessionId: string;
}): Promise<CapturedSnapshot> {
  const stabilization = await waitForSnapshotStability(input.page);
  const elements = await scanVisibleDom(input.page);
  await waitForRafCycles(input.page, 2);
  const accessibility = {};
  const snapshot: ReconSnapshot = {
    scenario_id: input.scenarioId,
    state: input.state,
    url: input.page.url(),
    timestamp: new Date().toISOString(),
    action_before_snapshot: input.actionBeforeSnapshot,
    decision: redactDecisionForArtifact(input.decision),
    action_error: input.actionError,
    snapshotSessionId: input.snapshotSessionId,
    snapshotSequence: input.sequence,
    stabilization,
    elements,
    accessibility
  };
  const filePath = await writeStateSnapshot(snapshot, input.scenarioDir, input.sequence);
  logger.info(`[dynamic-runner] Captured ${input.state} -> ${filePath}`);
  return { filePath, snapshot };
}

async function verifyActionEffect(
  page: Page,
  before: ReconSnapshot,
  after: ReconSnapshot,
  decision: ReconDecision
): Promise<EffectVerification> {
  if (decision.actionStatus === 'failed') {
    return {
      status: 'failed',
      reason: decision.actionError ?? 'Action failed before effect verification.'
    };
  }

  if (decision.actionStatus === 'skipped') {
    if (decision.parsedAction.actionType === 'verify') {
      const target = decision.parsedAction.target ?? decision.selectedValue;
      if (!target) {
        return {
          status: 'skipped',
          reason: 'Verification step had no target to assert.'
        };
      }

      return afterSnapshotContains(after, target)
        ? { status: 'passed', reason: `Verified visible page state contains "${target}".` }
        : { status: 'failed', reason: `Verification target "${target}" was not visible after the step.` };
    }

    return {
      status: 'skipped',
      reason: decision.actionError ?? decision.llmReason ?? 'Step was intentionally skipped.'
    };
  }

  if (decision.parsedAction.actionType === 'fill' && decision.selectedLocator && decision.selectedValue) {
    const locator = locatorFromExpression(page, decision.selectedLocator, decision.deterministicCandidates);
    if (!locator) {
      return { status: 'failed', reason: `Cannot verify unsupported fill locator: ${decision.selectedLocator}` };
    }

    const currentValue = await locator.inputValue().catch(() => null);
    const expectedValueForMessage = decision.parsedAction.isSensitiveValue ? '[REDACTED]' : decision.selectedValue;
    const currentValueForMessage = decision.parsedAction.isSensitiveValue ? '[REDACTED]' : currentValue;
    return currentValue === decision.selectedValue
      ? { status: 'passed', reason: 'Filled control value matches expected payload value.' }
      : { status: 'failed', reason: `Filled control value mismatch. Expected "${expectedValueForMessage}", got "${currentValueForMessage}".` };
  }

  if (decision.parsedAction.actionType === 'select') {
    if (decision.selectionVerified) {
      return { status: 'passed', reason: 'Dropdown option selection completed and was verified by the selector flow.' };
    }

    const selectedValueForMessage = decision.parsedAction.isSensitiveValue ? '[REDACTED]' : decision.selectedValue ?? '';
    return afterSnapshotContains(after, decision.selectedValue)
      ? { status: 'passed', reason: 'Selected value is visible after the step.' }
      : { status: 'failed', reason: `Selected value "${selectedValueForMessage}" was not visible after the step.` };
  }

  if (before.url !== after.url) {
    return { status: 'passed', reason: 'Page URL changed after the action.' };
  }

  if (snapshotSignature(before) !== snapshotSignature(after)) {
    return { status: 'passed', reason: 'DOM/accessibility state changed after the action.' };
  }

  return { status: 'passed', reason: 'Action executed and page reached a stable state.' };
}

function isPassingStep(decision: ReconDecision, verification: EffectVerification): boolean {
  if (verification.status === 'failed') {
    return false;
  }

  if (decision.actionStatus === 'success') {
    return true;
  }

  return decision.parsedAction.actionType === 'verify' && verification.status === 'passed';
}



async function captureFailureScreenshot(page: Page, screenshotDir: string, name: string): Promise<string | undefined> {
  const screenshotPath = path.join(screenshotDir, `${slugify(name)}-${Date.now()}.png`);
  await fs.ensureDir(screenshotDir);
  return page
    .screenshot({ path: screenshotPath, fullPage: true })
    .then(() => screenshotPath)
    .catch(() => undefined);
}

function failureReasonFor(decision: ReconDecision, verification: EffectVerification): string {
  if (decision.actionStatus === 'failed') {
    return decision.actionError ?? 'Action failed.';
  }

  if (verification.status === 'failed') {
    return verification.reason;
  }

  return decision.actionError ?? verification.reason;
}

function summarizeDecision(decision: ReconDecision): DecisionSummary {
  return {
    decisionSource: decision.decisionSource,
    actionStatus: decision.actionStatus,
    selectedLocator: decision.selectedLocator,
    selectedValue: decision.parsedAction.isSensitiveValue && decision.selectedValue !== null ? '[REDACTED]' : decision.selectedValue,
    confidence: decision.confidence,
    selectorRisk: decision.selectorRisk,
    llmReason: decision.llmReason,
    actionError: decision.actionError,
    executed: decision.executed,
    llmUsed: decision.decisionSource === 'llm',
    llmPromptTokenEstimate: decision.llmPromptTokenEstimate,
    llmResponseTokenEstimate: decision.llmResponseTokenEstimate,
    llmTotalTokenEstimate: decision.llmTotalTokenEstimate,
    actionType: decision.parsedAction?.actionType
  };
}

async function loadRuntimePayloads(inputDataPath: string): Promise<Map<string, Record<string, unknown>>> {
  try {
    const records = await readTestData(inputDataPath);
    return new Map(records.map((record) => [record.scenario_id, record.payload]));
  } catch (error) {
    logger.warn('Runtime payload reload failed; using scenario artifact payload only.', error);
    return new Map();
  }
}

function redactDecisionForArtifact(decision: ReconDecision | null): ReconDecision | null {
  if (!decision?.parsedAction.isSensitiveValue) {
    return decision;
  }

  return {
    ...decision,
    selectedValue: decision.selectedValue === null ? null : '[REDACTED]',
    optionValue: decision.optionValue === null ? null : decision.optionValue === undefined ? undefined : '[REDACTED]',
    parsedAction: {
      ...decision.parsedAction,
      value: decision.parsedAction.value === null ? null : '[REDACTED]'
    }
  };
}

function afterSnapshotContains(snapshot: ReconSnapshot, value: string | null): boolean {
  if (!value) {
    return false;
  }

  return snapshot.elements.some((element) =>
    [element.text, element.value, element.ariaLabel, element.label]
      .filter((candidate): candidate is string => Boolean(candidate))
      .some((candidate) => candidate.toLowerCase().includes(value.toLowerCase()))
  );
}

function snapshotSignature(snapshot: ReconSnapshot): string {
  return snapshot.elements
    .filter((element) => element.isVisible)
    .map((element) => `${element.tag}:${element.role ?? ''}:${element.text ?? ''}:${element.value ?? ''}`)
    .join('|')
    .slice(0, 8000);
}

async function recordSnapshot(captured: CapturedSnapshot, snapshots: SnapshotReference[]): Promise<void> {
  snapshots.push({
    state: captured.snapshot.state,
    path: captured.filePath
  });
}

function extractStepSnapshots(step: StepExecutionReport): SnapshotReference[] {
  return [
    step.beforeSnapshotPath ? { state: `step-${step.stepNo}-before`, path: step.beforeSnapshotPath } : null,
    step.afterSnapshotPath ? { state: `step-${step.stepNo}-after`, path: step.afterSnapshotPath } : null,
    step.repairBeforeSnapshotPath ? { state: `step-${step.stepNo}-repair-before`, path: step.repairBeforeSnapshotPath } : null,
    step.repairAfterSnapshotPath ? { state: `step-${step.stepNo}-repair-after`, path: step.repairAfterSnapshotPath } : null
  ].filter((item): item is SnapshotReference => item !== null);
}

function createRunReport(scenarios: ScenarioExecutionReport[]): DynamicRunReport {
  const allSteps = scenarios.flatMap((scenario) => scenario.steps);
  const allDecisions = allSteps.flatMap((step) =>
    [step.decision, step.repairDecision].filter((decision): decision is DecisionSummary => Boolean(decision))
  );

  return {
    generatedAt: new Date().toISOString(),
    command: 'npm run run:webwright',
    mode: 'hybrid-webwright-step-runner',
    summary: {
      total: scenarios.length,
      passed: scenarios.filter((scenario) => scenario.status === 'passed').length,
      failed: scenarios.filter((scenario) => scenario.status === 'failed').length,
      totalSteps: allSteps.length,
      passedSteps: allSteps.filter((step) => step.status === 'passed').length,
      failedSteps: allSteps.filter((step) => step.status === 'failed').length,
      repairedSteps: allSteps.filter((step) => step.status === 'repaired').length,
      llmDecisionCount: allDecisions.filter((decision) => decision.llmUsed).length,
      estimatedLlmTokens: allDecisions.reduce((sum, decision) => sum + (decision.llmTotalTokenEstimate ?? 0), 0)
    },
    scenarios
  };
}

function stepLlmTokenEstimate(step: StepExecutionReport): number {
  return (step.decision.llmTotalTokenEstimate ?? 0) + (step.repairDecision?.llmTotalTokenEstimate ?? 0);
}

function renderDynamicReport(report: DynamicRunReport): string {
  const rows = report.scenarios
    .map((scenario) => {
      const stepRows = scenario.steps
        .map(
          (step) => `<tr>
            <td>${step.stepNo}</td>
            <td>${escapeHtml(step.instruction)}</td>
            <td><span class="${step.status}">${step.status}</span></td>
            <td>${escapeHtml(step.decision.selectedLocator ?? '')}</td>
            <td>${escapeHtml(step.failureReason ?? '')}</td>
            <td>${step.repairAttempted ? escapeHtml(step.repairSucceeded ? 'yes, succeeded' : 'yes, failed') : 'no'}</td>
            <td>${escapeHtml(String(stepLlmTokenEstimate(step)))}</td>
            <td>${escapeHtml(step.beforeSnapshotPath ?? '')}<br />${escapeHtml(step.afterSnapshotPath ?? '')}</td>
            <td>${escapeHtml(step.screenshotPath ?? step.repairScreenshotPath ?? '')}</td>
          </tr>`
        )
        .join('');

      return `<section>
        <h2>${escapeHtml(scenario.scenarioId)} - ${escapeHtml(scenario.status)}</h2>
        <p>${escapeHtml(scenario.module ?? '')} ${escapeHtml(scenario.action ?? '')}</p>
        <p>Failure: ${escapeHtml(scenario.failureReason ?? '')}</p>
        <table>
          <thead>
            <tr>
              <th>Step</th>
              <th>Instruction</th>
              <th>Status</th>
              <th>Locator</th>
              <th>Failure</th>
              <th>Repair</th>
              <th>Estimated LLM Tokens</th>
              <th>Snapshots</th>
              <th>Screenshot</th>
            </tr>
          </thead>
          <tbody>${stepRows}</tbody>
        </table>
      </section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Dynamic Step Runner Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #172033; }
    .summary { display: flex; gap: 12px; margin: 16px 0 24px; }
    .metric { border: 1px solid #d7dce5; border-radius: 8px; padding: 10px 14px; }
    .metric strong { display: block; font-size: 22px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 24px; font-size: 13px; }
    th, td { border: 1px solid #d7dce5; padding: 8px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
    th { background: #f5f7fb; }
    .passed, .repaired { color: #047857; font-weight: 700; }
    .failed { color: #b91c1c; font-weight: 700; }
    .skipped { color: #92400e; font-weight: 700; }
  </style>
</head>
<body>
  <h1>Dynamic Step Runner Report</h1>
  <p>Generated at ${escapeHtml(report.generatedAt)}</p>
  <div class="summary">
    <div class="metric"><strong>${report.summary.total}</strong>Scenarios</div>
    <div class="metric"><strong>${report.summary.passed}</strong>Passed</div>
    <div class="metric"><strong>${report.summary.failed}</strong>Failed</div>
    <div class="metric"><strong>${report.summary.totalSteps}</strong>Steps</div>
    <div class="metric"><strong>${report.summary.repairedSteps}</strong>Repaired</div>
    <div class="metric"><strong>${report.summary.llmDecisionCount}</strong>LLM Calls</div>
    <div class="metric"><strong>${report.summary.estimatedLlmTokens}</strong>Est. Tokens</div>
  </div>
  ${rows}
</body>
</html>`;
}

function formatTimestamp(date: Date): string {
  const pad = (num: number) => String(num).padStart(2, '0');
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = date.getSeconds();
  return `${yyyy}${MM}${dd}-${hh}${mm}${pad(ss)}`;
}

if (require.main === module) {
  runDynamicScenarios().catch((error) => {
    logger.error('Dynamic scenario runner failed.', error);
    process.exitCode = 1;
  });
}
