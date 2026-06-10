import path from 'node:path';
import { chromium, type Locator, type Page } from '@playwright/test';
import fs from 'fs-extra';
import { getFrameworkPaths, getWebEnv } from '../config/env';
import type { ReconSnapshot, Scenario, ScenarioStep } from '../types';
import { ensureScenarioActions, type ScenarioAtomicAction } from '../specs/mdActionExtractor';
import { listFiles, readJsonFile, readTextFile, toSafeFileName } from '../utils/fileUtils';
import { logger } from '../utils/logger';
import { decideAndExecuteAction } from './actionDecisionEngine';
import { scanVisibleDom } from './domScanner';
import { performLogin, safeAction } from '../utils/playwrightUtils';
import { waitForRafCycles, waitForSnapshotStability } from './pageStabilizer';
import { extractReconActions } from './reconActionExtractor';
import type { ReconDecision } from './reconDecisionTypes';
import { writeStateSnapshot } from './stateSnapshotWriter';

interface CapturedSnapshot {
  filePath: string;
  snapshot: ReconSnapshot;
}

export async function runInteractiveRecon(options: {
  scenarioDir?: string;
  specDir?: string;
  outputDir?: string;
} = {}): Promise<string[]> {
  process.env.IS_RECON = 'true';
  const env = getWebEnv();
  const paths = getFrameworkPaths();
  const scenarioDir = options.scenarioDir ?? paths.scenarioDir;
  const specDir = options.specDir ?? paths.specDir;
  const outputDir = options.outputDir ?? paths.reconDir;
  const scenarioFiles = await listFiles(scenarioDir, '.json');
  const writtenSnapshots: string[] = [];

  if (scenarioFiles.length === 0) {
    throw new Error(`No scenario files found in ${scenarioDir}. Run npm run build:scenarios first.`);
  }

  const browser = await chromium.launch({
    headless: env.HEADLESS,
    slowMo: env.SLOW_MO
  });

  try {
    for (const scenarioFile of scenarioFiles) {
      const scenario = await readJsonFile<Scenario>(scenarioFile);
      const safeScenarioId = toSafeFileName(scenario.scenario_id);
      const scenarioReconDir = path.join(outputDir, safeScenarioId);
      await fs.emptyDir(scenarioReconDir);

      const specPath = path.join(specDir, `${safeScenarioId}.md`);
      const plan = (await fs.pathExists(specPath)) ? await readTextFile(specPath) : '';
      if (!plan) {
        logger.warn(`No Markdown plan found for ${scenario.scenario_id}; recon will use scenario steps only.`);
      }
      const atomicActions = await ensureScenarioActions({
          scenario,
          specsDir: specDir,
          scenarioDir,
          outputDir: paths.scenarioActionDir
        });
      const reconSteps = atomicActions.length > 0 ? atomicActions.map(toReconStep) : scenario.steps;

      if (atomicActions.length > 0) {
        logger.info(
          `[Recon] Loaded ${atomicActions.length} atomic action(s) from scenario-actions/${safeScenarioId}.actions.json`
        );
        for (const action of atomicActions) {
          console.log(
            `[Recon] Step ${action.stepNo}: ${action.actionType} -> ${action.target ?? 'none'}${
              action.value ? ` = ${action.value}` : ''
            }`
          );
        }
      } else {
        logger.warn(`[Recon] No scenario-actions file found for ${scenario.scenario_id}; using normalized Excel scenario steps.`);
      }

      const context = await browser.newContext();
      const page = await context.newPage();
      const snapshotSessionId = `${safeScenarioId}-${Date.now()}`;
      let sequence = 1;
      const previousActionErrors: string[] = [];

      try {
        await page.goto(env.WEBSITE_URL, { waitUntil: 'domcontentloaded' });
        const loginSnapshot = await captureSnapshot({
          page,
          scenarioId: scenario.scenario_id,
          scenarioReconDir,
          sequence: sequence++,
          state: 'login-page',
          actionBeforeSnapshot: 'Open login page',
          decision: null,
          actionError: null,
          snapshotSessionId
        });
        writtenSnapshots.push(loginSnapshot.filePath);

        const loginError = await safeAction(() => performLogin(page, env.LOGIN_EMAIL, env.LOGIN_PASSWORD, waitForSettledPage));
        if (loginError) {
          previousActionErrors.push(`login: ${loginError}`);
        }
        const dashboardSnapshot = await captureSnapshot({
          page,
          scenarioId: scenario.scenario_id,
          scenarioReconDir,
          sequence: sequence++,
          state: 'dashboard-page',
          actionBeforeSnapshot: 'Perform login',
          decision: null,
          actionError: loginError,
          snapshotSessionId
        });
        writtenSnapshots.push(dashboardSnapshot.filePath);

        for (let i = 0; i < reconSteps.length; i++) {
          const step = reconSteps[i];
          const stepNo = step.step_no ?? (i + 1);
          const isLastStep = i === reconSteps.length - 1;

          const before = await captureSnapshot({
            page,
            scenarioId: scenario.scenario_id,
            scenarioReconDir,
            sequence: sequence++,
            state: `step-${stepNo}-before`,
            actionBeforeSnapshot: step.instruction,
            decision: null,
            actionError: null,
            snapshotSessionId
          });
          writtenSnapshots.push(before.filePath);

          const decision = await decideAndExecuteAction({
            page,
            scenarioId: scenario.scenario_id,
            step,
            payload: scenario.payload,
            snapshotElements: before.snapshot.elements,
            previousActionErrors,
            isLastStep,
            onIntermediateSnapshot: async (state: string, actionBeforeSnapshot: string, intermediateDecision: ReconDecision) => {
              const dropdownSnapshot = await captureSnapshot({
                page,
                scenarioId: scenario.scenario_id,
                scenarioReconDir,
                sequence: sequence++,
                state,
                actionBeforeSnapshot,
                decision: intermediateDecision,
                actionError: intermediateDecision.actionError ?? null,
                snapshotSessionId
              });
              writtenSnapshots.push(dropdownSnapshot.filePath);
            }
          });

          if (decision.actionError) {
            previousActionErrors.push(`step ${stepNo}: ${decision.actionError}`);
          }
          logReconDecision(stepNo, step.instruction, decision);

          const after = await captureSnapshot({
            page,
            scenarioId: scenario.scenario_id,
            scenarioReconDir,
            sequence: sequence++,
            state: `step-${stepNo}-after`,
            actionBeforeSnapshot: step.instruction,
            decision,
            actionError: decision.actionError ?? null,
            snapshotSessionId
          });
          writtenSnapshots.push(after.filePath);
        }
      } finally {
        await context.close();
      }

      const extractedActions = await extractReconActions(scenario.scenario_id, outputDir);
      logger.info(`Extracted ${extractedActions.length} recon action(s) for ${scenario.scenario_id}.`);
    }
  } finally {
    await browser.close();
  }

  return writtenSnapshots;
}

function logReconDecision(stepNo: number, instruction: string, decision: ReconDecision): void {
  const parsed = decision.parsedAction;
  const valueKey =
    parsed.value && parsed.target && parsed.target !== '__FORM__' && ['fill', 'select'].includes(parsed.actionType)
      ? parsed.payloadKey ?? parsed.target
      : 'none';
  const safeCandidates = decision.validatedCandidates.filter((candidate) => candidate.isSafe).length;
  const llmUsed = decision.decisionSource === 'llm' ? 'yes' : 'no';
  const llmParseStatus = decision.llmParseError ? 'failed' : decision.decisionSource === 'llm' ? 'success' : 'not_used';

  console.log(`[Recon] Step ${stepNo}: ${instruction}`);
  console.log(`[Recon] Parsed: ${parsed.actionType} -> ${parsed.target ?? 'none'}`);
  console.log(`[Recon] Value key used: ${valueKey}`);
  console.log(`[Recon] Deterministic candidates: ${decision.deterministicCandidates.length}`);
  console.log(`[Recon] Safe candidates: ${safeCandidates}`);
  console.log(`[Recon] LLM used: ${llmUsed}`);
  console.log(`[Recon] LLM parse status: ${llmParseStatus}`);
  console.log(`[Recon] Action confidence: ${decision.confidence ?? 'n/a'}`);
  console.log(
    `[Recon] Selector confidence: ${decision.selectorConfidenceScore ?? 'n/a'} (${decision.selectorRisk ?? 'n/a'})`
  );
  if (decision.llmParseError) {
    console.log(`[Recon] LLM parse error: ${decision.llmParseError}`);
    console.log(`[Recon] LLM raw response preview: ${decision.llmRawResponsePreview ?? ''}`);
    console.log(`[Recon] LLM correction retry status: ${decision.llmRetryStatus ?? 'not_used'}`);
  }
  console.log(`[Recon] Selected locator: ${decision.selectedLocator ?? 'none'}`);
  console.log(`[Recon] Status: ${decision.actionStatus}`);
}

function toReconStep(action: ScenarioAtomicAction): ScenarioStep & { atomicAction: ScenarioAtomicAction } {
  return {
    step_no: action.stepNo,
    instruction: actionInstruction(action),
    raw_instruction: action.rawActionText,
    expected_result: action.assertionHint ?? undefined,
    atomicAction: action
  };
}

function actionInstruction(action: ScenarioAtomicAction): string {
  const target = action.target ?? '';

  switch (action.actionType) {
    case 'navigate':
      return target ? `Navigate to ${target}` : action.rawActionText;
    case 'click':
      return target ? `Click ${target}` : action.rawActionText;
    case 'fill':
      return target ? `Fill ${target}` : action.rawActionText;
    case 'select':
      return target ? `Select ${target}` : action.rawActionText;
    case 'row_action':
      return target ? `Click ${target}` : action.rawActionText;
    case 'verify':
      return target ? `Verify ${target}` : action.rawActionText;
    case 'wait':
      return 'Wait';
    default:
      return action.rawActionText;
  }
}

async function captureSnapshot(input: {
  page: Page;
  scenarioId: string;
  scenarioReconDir: string;
  sequence: number;
  state: string;
  actionBeforeSnapshot: string;
  decision: ReconDecision | null;
  actionError: string | null;
  snapshotSessionId: string;
}): Promise<CapturedSnapshot> {
  const stabilization = await waitForSnapshotStability(input.page);
  if (stabilization.timedOut) {
    logger.warn(
      `[stabilizer] timeout reached before quiet window (state=${input.state}, quietWindowMs=${stabilization.mutationQuietWindowMs}, durationMs=${stabilization.durationMs}).`
    );
  }
  const elements = await scanVisibleDom(input.page);
  await waitForRafCycles(input.page, 2);
  const accessibility = {};
  const snapshot: ReconSnapshot = {
    scenario_id: input.scenarioId,
    state: input.state,
    url: input.page.url(),
    timestamp: new Date().toISOString(),
    action_before_snapshot: input.actionBeforeSnapshot,
    decision: input.decision,
    action_error: input.actionError,
    snapshotSessionId: input.snapshotSessionId,
    snapshotSequence: input.sequence,
    stabilization,
    elements,
    accessibility
  };

  const filePath = await writeStateSnapshot(snapshot, input.scenarioReconDir, input.sequence);
  logger.info(`Captured recon snapshot -> ${filePath}`);
  return { filePath, snapshot };
}



async function waitForSettledPage(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(250);
}

if (require.main === module) {
  runInteractiveRecon()
    .then((snapshots) => {
      logger.info(`Captured ${snapshots.length} recon snapshot(s).`);
    })
    .catch((error) => {
      logger.error('Interactive recon failed.', error);
      process.exitCode = 1;
    });
}
