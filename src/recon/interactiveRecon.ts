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
import { NetworkTracker } from './networkTracker';

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
  const scenarioDir = options.scenarioDir ?? process.env.SCENARIOS_DIR ?? resolveFromRoot('scenarios');
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

      let currentRole = scenario.steps[0]?.role || 'default';
      let context = await browser.newContext();
      let page = await context.newPage();
      let networkTracker = new NetworkTracker(page);
      const snapshotSessionId = `${safeScenarioId}-${Date.now()}`;
      let sequence = 1;
      const previousActionErrors: string[] = [];

      try {
        const initialCreds = await getCredentialsForRole(scenario, currentRole, env);
        await page.goto(normalizeWebsiteEntryUrl(env.WEBSITE_URL), { waitUntil: 'domcontentloaded' });
        const loginSnapshot = await captureSnapshot({
          page,
          scenarioId: scenario.scenario_id,
          scenarioReconDir,
          sequence: sequence++,
          state: 'login-page',
          actionBeforeSnapshot: `Open login page (${currentRole})`,
          decision: null,
          actionError: null,
          snapshotSessionId,
          networkTracker
        });
        writtenSnapshots.push(loginSnapshot.filePath);

        const loginError = await safeAction(() => performLogin(page, initialCreds.email, initialCreds.password));
        if (loginError) {
          previousActionErrors.push(`login: ${loginError}`);
        }
        const dashboardSnapshot = await captureSnapshot({
          page,
          scenarioId: scenario.scenario_id,
          scenarioReconDir,
          sequence: sequence++,
          state: 'dashboard-page',
          actionBeforeSnapshot: `Perform login (${currentRole})`,
          decision: null,
          actionError: loginError,
          snapshotSessionId,
          networkTracker
        });
        writtenSnapshots.push(dashboardSnapshot.filePath);

        for (const step of scenario.steps) {
          const stepNo = step.step_no ?? scenario.steps.indexOf(step) + 1;
          const targetRole = step.role || currentRole;

          if (targetRole !== currentRole) {
            logger.info(`Switching context from role ${currentRole} to ${targetRole}`);
            await page.close().catch(() => {});
            await context.close().catch(() => {});

            context = await browser.newContext();
            page = await context.newPage();
            networkTracker = new NetworkTracker(page);
            currentRole = targetRole;

            const roleCreds = await getCredentialsForRole(scenario, currentRole, env);
            await page.goto(normalizeWebsiteEntryUrl(env.WEBSITE_URL), { waitUntil: 'domcontentloaded' });
            
            const roleLoginSnapshot = await captureSnapshot({
              page,
              scenarioId: scenario.scenario_id,
              scenarioReconDir,
              sequence: sequence++,
              state: `role-switch-login-${currentRole}`,
              actionBeforeSnapshot: `Open login page for ${currentRole}`,
              decision: null,
              actionError: null,
              snapshotSessionId,
              networkTracker
            });
            writtenSnapshots.push(roleLoginSnapshot.filePath);

            const roleLoginError = await safeAction(() => performLogin(page, roleCreds.email, roleCreds.password));
            if (roleLoginError) {
              previousActionErrors.push(`login switch to ${currentRole}: ${roleLoginError}`);
            }

            const roleDashboardSnapshot = await captureSnapshot({
              page,
              scenarioId: scenario.scenario_id,
              scenarioReconDir,
              sequence: sequence++,
              state: `role-switch-dashboard-${currentRole}`,
              actionBeforeSnapshot: `Perform login for ${currentRole}`,
              decision: null,
              actionError: roleLoginError,
              snapshotSessionId,
              networkTracker
            });
            writtenSnapshots.push(roleDashboardSnapshot.filePath);
          }

          const before = await captureSnapshot({
            page,
            scenarioId: scenario.scenario_id,
            scenarioReconDir,
            sequence: sequence++,
            state: `step-${stepNo}-before`,
            actionBeforeSnapshot: step.instruction,
            decision: null,
            actionError: null,
            snapshotSessionId,
            networkTracker
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
                snapshotSessionId,
                networkTracker
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
            snapshotSessionId,
            networkTracker
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
  const deterministicSafeCount = decision.deterministicCandidates.filter((candidate) =>
    decision.validatedCandidates.some((validation) => validation.locator === candidate.locator && validation.isSafe)
  ).length;
  const totalSafeCount = decision.validatedCandidates.filter((candidate) => candidate.isSafe).length;
  const llmUsed = decision.decisionSource === 'llm' ? 'yes' : 'no';
  const llmParseStatus = decision.llmParseError ? 'failed' : decision.decisionSource === 'llm' ? 'success' : 'not_used';

  console.log(`[Recon] Step ${stepNo}: ${instruction}`);
  console.log(`[Recon] Parsed: ${parsed.actionType} -> ${parsed.target ?? 'none'}`);
  console.log(`[Recon] Parse status: ${parsed.parseStatus ?? 'n/a'} (${parsed.parseReason ?? 'n/a'})`);
  console.log(`[Recon] Value key used: ${valueKey}`);
  console.log(`[Recon] Deterministic candidates: ${decision.deterministicCandidates.length}`);
  console.log(`[Recon] Deterministic safe candidates: ${deterministicSafeCount}`);
  if (decision.decisionSource === 'llm') {
    console.log(`[Recon] LLM validated safe candidates: ${totalSafeCount - deterministicSafeCount}`);
  }
  console.log(`[Recon] LLM used: ${llmUsed}`);
  console.log(`[Recon] LLM parse status: ${llmParseStatus}`);

  if (decision.decisionSource === 'llm' && decision.llmReason && !decision.selectedLocator) {
    console.log(`[Recon] LLM decision: ${decision.llmReason}`);
  }
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
  networkTracker?: NetworkTracker;
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
  const failedApiRequests = input.networkTracker ? input.networkTracker.getAndClearFailedRequests() : undefined;
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
    accessibility,
    failedApiRequests
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

  await page
    .waitForURL((url) => !/\/login\/?$/i.test(url.pathname), { timeout: 20_000 })
    .catch(() => undefined);
  await page.waitForURL(/dashboard|users/i, { timeout: 20_000 }).catch(() => undefined);
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

async function getCredentialsForRole(scenario: Scenario, roleName: string, env: any): Promise<{ email: string; password: string }> {
  const jsonPath = scenario.metadata?.source_json ? resolveFromRoot(scenario.metadata.source_json) : resolveFromRoot('input/test_data.json');
  try {
    if (await fs.pathExists(jsonPath)) {
      const records = await fs.readJson(jsonPath);
      if (Array.isArray(records)) {
        const credsRecord = records.find(
          (r: any) => r.scenario_id === 'role_credentials' || r.scenario_id === 'GLOBAL_CREDENTIALS'
        );
        if (credsRecord && credsRecord.payload && credsRecord.payload[roleName]) {
          const creds = credsRecord.payload[roleName];
          if (creds.email && creds.password) {
            return { email: creds.email, password: creds.password };
          }
        }
      }
    }
  } catch (err) {
    logger.error('Error reading role credentials', err);
  }
  return { email: env.LOGIN_EMAIL, password: env.LOGIN_PASSWORD };
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
