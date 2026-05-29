import path from 'node:path';
import { chromium, type Locator, type Page } from '@playwright/test';
import fs from 'fs-extra';
import { getWebEnv } from '../config/env';
import { normalizeWebsiteEntryUrl } from '../utils/websiteUrl';
import type { ReconSnapshot, Scenario } from '../types';
import { listFiles, readJsonFile, readTextFile, resolveFromRoot, toSafeFileName } from '../utils/fileUtils';
import { logger } from '../utils/logger';
import { decideAndExecuteAction } from './actionDecisionEngine';
import { scanAccessibility } from './accessibilityScanner';
import { scanVisibleDom } from './domScanner';
import { waitForRafCycles, waitForSnapshotStability } from './pageStabilizer';
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
  const env = getWebEnv();
  const scenarioDir = options.scenarioDir ?? resolveFromRoot('scenarios');
  const specDir = options.specDir ?? resolveFromRoot('specs');
  const outputDir = options.outputDir ?? resolveFromRoot('recon');
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

      const context = await browser.newContext();
      const page = await context.newPage();
      const snapshotSessionId = `${safeScenarioId}-${Date.now()}`;
      let sequence = 1;
      const previousActionErrors: string[] = [];

      try {
        await page.goto(normalizeWebsiteEntryUrl(env.WEBSITE_URL), { waitUntil: 'domcontentloaded' });
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

        const loginError = await safeAction(() => performLogin(page, env.LOGIN_EMAIL, env.LOGIN_PASSWORD));
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

        for (const step of scenario.steps) {
          const stepNo = step.step_no ?? scenario.steps.indexOf(step) + 1;
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
            onIntermediateSnapshot: async (state, actionBeforeSnapshot, intermediateDecision) => {
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
      ? parsed.target
      : 'none';
  const safeCandidates = decision.validatedCandidates.filter((candidate) => candidate.isSafe).length;
  const llmUsed = decision.decisionSource === 'llm' ? 'yes' : 'no';
  const llmParseStatus = decision.llmParseError ? 'failed' : decision.decisionSource === 'llm' ? 'success' : 'not_used';

  console.log(`[Recon] Step ${stepNo}: ${instruction}`);
  console.log(`[Recon] Parsed: ${parsed.actionType} -> ${parsed.target ?? 'none'}`);
  console.log(`[Recon] Parse status: ${parsed.parseStatus ?? 'n/a'} (${parsed.parseReason ?? 'n/a'})`);
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
  const failureCategory = classifyFailure(decision.actionError);
  if (failureCategory) {
    console.log(`[Recon] Failure category: ${failureCategory}`);
  }
  console.log(`[Recon] Status: ${decision.actionStatus}`);
}

function classifyFailure(actionError?: string | null): string | null {
  if (!actionError) {
    return null;
  }
  if (actionError.startsWith('parse_failure:')) return 'parse_failure';
  if (actionError.startsWith('postcondition_failure:')) return 'postcondition_failure';
  return 'locator_failure';
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
  const accessibility = await scanAccessibility(input.page);
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

async function performLogin(page: Page, email: string, password: string): Promise<void> {
  await fillFirst(page, email, [
    () => page.getByLabel(/email|username|user name/i),
    () => page.getByPlaceholder(/email|username|user name/i),
    () => page.locator('input[type="email"]').first(),
    () => page.locator('input[name*="email" i], input[name*="user" i]').first()
  ]);

  await fillFirst(page, password, [
    () => page.getByLabel(/password/i),
    () => page.getByPlaceholder(/password/i),
    () => page.locator('input[type="password"]').first(),
    () => page.locator('input[name*="password" i]').first()
  ]);

  await clickFirst(page, [
    () => page.getByRole('button', { name: /login|sign in|submit/i }),
    () => page.locator('button[type="submit"]').first(),
    () => page.getByText(/login|sign in|submit/i).first()
  ]);

  await waitForSettledPage(page);
}

async function fillFirst(page: Page, value: string, locatorFactories: Array<() => Locator>): Promise<void> {
  for (const createLocator of locatorFactories) {
    const locator = createLocator();
    if (await isUsable(locator)) {
      await locator.fill(value);
      return;
    }
  }

  throw new Error('No usable input locator found.');
}

async function clickFirst(page: Page, locatorFactories: Array<() => Locator>): Promise<void> {
  for (const createLocator of locatorFactories) {
    const locator = createLocator();
    if (await isUsable(locator)) {
      await locator.click();
      return;
    }
  }

  throw new Error('No usable click locator found.');
}

async function isUsable(locator: Locator): Promise<boolean> {
  try {
    const first = locator.first();
    return (await first.count()) > 0 && (await first.isVisible({ timeout: 750 })) && (await first.isEnabled({ timeout: 750 }));
  } catch {
    return false;
  }
}

async function safeAction(action: () => Promise<void>): Promise<string | null> {
  try {
    await action();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function waitForSettledPage(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
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
