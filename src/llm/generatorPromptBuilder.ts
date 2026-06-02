import type { Scenario, ReconSnapshot } from '../types';
import type { ReconAction } from '../recon/reconActionExtractor';
import { sanitizePayload } from '../recon/actionParser';
import {
  isDropdownSelectAction,
  isSearchStep,
  payloadValueExpressionForAction,
  searchPayloadExpression
} from '../recon/actionSemantics';
import { truncate } from '../utils/fileUtils';
import { urlAssertionFromPostActionUrl, escapeRegexForLiteral, extractStepAssertions } from '../recon/assertionExtractor';

export function buildGeneratorPrompt(input: {
  scenario: Scenario;
  plan: string;
  reconActions: ReconAction[];
  dropdownSnapshots: CompactDropdownSnapshot[];
}): string {
  return truncate(
    [
      'You are an expert TypeScript Playwright test generator.',
      '',
      'You MUST generate the Playwright test from the provided reconAction list.',
      'The reconAction list is the source of truth for locators, URLs, and post-step state.',
      'Do not invent app-specific routes, module names, or payload field names.',
      'Do not invent generic locators when selectedLocator exists.',
      'Do not stop after login.',
      'Every action in reconAction must appear in the generated test.',
      '',
      'Hard rules:',
      '1. Use @playwright/test with TypeScript.',
      '2. Use test.step for login and for every reconAction. The name of the test.step for each reconAction MUST be exactly "Step [stepNo]: [rawStep]" (for example: "Step 1: Navigate to User Management.").',
      '3. Perform a full login sequence in the login step. Read credentials from process.env.LOGIN_EMAIL and process.env.LOGIN_PASSWORD. Locate username/password inputs and click submit. Example login sequence pattern:',
      '   const loginUrl = process.env.LOGIN_URL ?? process.env.WEBSITE_URL ?? build from APP_BASE_URL + LOGIN_PATH;',
      '   await page.goto(loginUrl);',
      '   await page.getByPlaceholder(/email|username/i).fill(process.env.LOGIN_EMAIL || "");',
      '   await page.getByPlaceholder(/password/i).fill(process.env.LOGIN_PASSWORD || "");',
      '   await page.getByRole("button", { name: /login|sign in|submit/i }).click();',
      '4. Never call page.goto(`${baseURL}/login/`).',
      '5. Never append /login/ manually when WEBSITE_URL is present.',
      '6. After login, assert visibility of the first recon action selectedLocator (from reconActions[0]).',
      '7. For successful recon actions, use reconAction.selectedLocator exactly.',
      '8. For custom dropdowns, never use selectOption unless recon proves a native select element.',
      '9. For failed select steps, use dropdownLocator + optionValue from recon and dropdown-open snapshot elements.',
      '10. Use payload values from scenario JSON only via payload[KEY] expressions.',
      '11. Search steps must fill the search field using payload values (e.g., payload["Email Address"] or similar), not only click the placeholder.',
      '12. Derive post-step assertions from postActionUrl or postActionLandmarkLocator on each reconAction when present.',
      '13. Never call selectCustomDropdown with an empty option value.',
      '14. Use { timeout: 15000 } on post-navigation expect().toBeVisible() / toHaveURL() assertions.',
      '15. Output full code only. No Markdown. No explanation.',
      '16. When clicking custom dropdown inputs (especially readonly input/combobox elements), always use { force: true } to bypass pointer-event interception by overlays.',
      '17. Even if a recon action has actionStatus "failed", you MUST still generate the Playwright actions (such as .fill(payload[KEY]), .click(), etc.) using the reconAction.selectedLocator (or a fallback / placeholder locator), rather than skipping the action or leaving the step empty.',
      '18. Search inputs often have the ARIA role "searchbox" instead of "textbox". If a textbox locator failed during recon, attempt both getByRole("searchbox", ...) and getByRole("textbox", ...), or use getByPlaceholder(/Search by name or email/i) to be resilient.',
      '19. When asserting input or dropdown values (especially multiselect comboboxes), use RegExp patterns (e.g., toHaveValue(new RegExp(payload[KEY])) or toHaveValue(/value/i)) instead of exact string matches, because the value may contain other/multiple selected items.',
      '',
      'Scenario JSON:',
      JSON.stringify(input.scenario, null, 2),
      '',
      'Markdown test plan:',
      input.plan,
      '',
      'Recon actions:',
      JSON.stringify(input.reconActions, null, 2),
      '',
      'Relevant dropdown-open snapshots:',
      JSON.stringify(input.dropdownSnapshots, null, 2)
    ].join('\n'),
    80_000
  );
}

export interface CompactDropdownSnapshot {
  state: string;
  url: string;
  action_before_snapshot?: string;
  stepNo?: number;
  elements: Array<{
    tag: string;
    text?: string;
    role?: string;
    ariaLabel?: string;
    label?: string;
    suggestedLocator?: string;
    locatorPriority?: string[];
  }>;
}

export function compactDropdownSnapshot(snapshot: ReconSnapshot): CompactDropdownSnapshot {
  return {
    state: snapshot.state,
    url: snapshot.url,
    action_before_snapshot: snapshot.action_before_snapshot,
    stepNo: snapshot.decision?.stepNo,
    elements: snapshot.elements
      .filter((element) => element.isVisible)
      .slice(0, 120)
      .map((element) => ({
        tag: element.tag,
        text: element.text,
        role: element.role,
        ariaLabel: element.ariaLabel,
        label: element.label,
        suggestedLocator: element.suggestedLocator,
        locatorPriority: element.locatorPriority
      }))
  };
}

interface RenderContext {
  reconActions: ReconAction[];
  actionIndex: number;
}

export async function buildDeterministicReconTest(scenario: Scenario, reconActions: ReconAction[]): Promise<string> {
  const title = `${scenario.scenario_id}: ${scenario.action ?? scenario.module ?? 'Generated scenario'}`;
  const payloadLiteral = JSON.stringify(scenario.payload, null, 2).replace(/\n/g, '\n  ');
  const actionSteps = (
    await Promise.all(
      reconActions.map((action, actionIndex) =>
        renderActionStep(action, scenario, {
          reconActions,
          actionIndex
        })
      )
    )
  ).join('\n\n');
  const loginAssertion = renderLoginPostAssertion(reconActions[0]);

  return `import { test, expect, type Locator, type Page } from '@playwright/test';

function escapeRegex(value: string): string {
  return value.replace(/[|\\\\{}()[\\]^$+*?.]/g, '\\\\$&');
}

function getLoginUrl(): string {
  const loginUrl =
    process.env.LOGIN_URL ??
    process.env.WEBSITE_URL ??
    (process.env.APP_BASE_URL
      ? \`\${process.env.APP_BASE_URL.replace(/\\/+$/, '')}/\${(process.env.LOGIN_PATH ?? 'login').replace(/^\\/+/, '')}\`
      : undefined);

  if (!loginUrl) {
    throw new Error('Missing LOGIN_URL, WEBSITE_URL, or APP_BASE_URL.');
  }

  return loginUrl;
}

async function firstUsable(locator: Locator): Promise<Locator | null> {
  const count = await locator.count().catch(() => 0);

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    const visible = await candidate.isVisible().catch(() => false);
    const enabled = await candidate.isEnabled().catch(() => false);

    if (visible && enabled) {
      return candidate;
    }
  }

  return null;
}

async function fillFirst(label: string, locators: Locator[], value: string): Promise<void> {
  for (const locator of locators) {
    const candidate = await firstUsable(locator);
    if (candidate) {
      await candidate.fill(value);
      return;
    }
  }

  throw new Error(\`Unable to find input for \${label}.\`);
}

async function clickFirst(label: string, locators: Locator[]): Promise<void> {
  for (const locator of locators) {
    const candidate = await firstUsable(locator);
    if (candidate) {
      await candidate.click();
      return;
    }
  }

  throw new Error(\`Unable to find clickable control for \${label}.\`);
}

async function selectCustomDropdown(page: Page, openDropdown: () => Locator, optionValue: string): Promise<void> {
  await openDropdown().click({ force: true });

  const exactOptionRegex = new RegExp(\`^\${escapeRegex(optionValue)}$\`, 'i');
  const optionCandidates = [
    page.locator('li.p-multiselect-item, li[role="option"]').filter({ hasText: exactOptionRegex }),
    page.getByRole('option', { name: exactOptionRegex }),
    page.locator('[role="listbox"], .p-dropdown-panel, .p-dropdown-items, .p-multiselect-panel').getByText(exactOptionRegex),
    page.getByText(exactOptionRegex)
  ];

  for (const locator of optionCandidates) {
    const candidate = await firstUsable(locator);
    if (candidate) {
      await candidate.click({ force: true });
      return;
    }
  }

  throw new Error(\`No safe option locator found for dropdown value: \${optionValue}\`);
}

test(${JSON.stringify(title)}, async ({ page }) => {
  page.on('response', response => {
    if (response.status() >= 500) {
      throw new Error(\`API Request to \${response.url()} failed with status \${response.status()}\`);
    }
  });

  const loginEmail = process.env.LOGIN_EMAIL;
  const loginPassword = process.env.LOGIN_PASSWORD;
  const payload = ${payloadLiteral} as const;

  if (!loginEmail || !loginPassword) {
    throw new Error('Missing LOGIN_EMAIL or LOGIN_PASSWORD.');
  }

  await test.step('Login to the application', async () => {
    const loginUrl = getLoginUrl();
    await page.goto(loginUrl);

    await fillFirst('login email', [
      page.getByLabel(/email|username/i),
      page.getByRole('textbox', { name: /email|username/i }),
      page.getByPlaceholder(/email|username/i)
    ], loginEmail);

    await fillFirst('login password', [
      page.getByLabel(/password/i),
      page.getByRole('textbox', { name: /password/i }),
      page.getByPlaceholder(/password/i)
    ], loginPassword);

    await clickFirst('login submit', [
      page.getByRole('button', { name: /login|sign in|submit/i }),
      page.getByText(/login|sign in|submit/i)
    ]);

${loginAssertion}
  });

${indent(actionSteps, 2)}
});
`;
}

async function renderActionStep(action: ReconAction, scenario: Scenario, context: RenderContext): Promise<string> {
  const stepTitle = `Step ${action.stepNo ?? '?'}: ${action.rawStep}`;
  const payload = scenario.payload;

  if (shouldSkipFailedReconStep(action, payload)) {
    return renderSkippedReconStep(stepTitle, action);
  }

  const locator = locatorForAction(action, payload, context);
  const nextAction = context.reconActions[context.actionIndex + 1];

  let stableRowLocator: string | null = null;
  if (isSearchStep(action.rawStep)) {
    stableRowLocator = nextAction ? stableUserRowLocatorExpression(payload, nextAction) : null;
    if (!stableRowLocator) {
      const key = Object.keys(payload).find((entry) => {
        const value = String(payload[entry] ?? '');
        return value.length > 0 && !/^(true|false)$/i.test(value);
      });
      if (key) {
        stableRowLocator = `page.getByText(String(payload[${JSON.stringify(key)}]))`;
      }
    }
  }

  const step = scenario.steps.find((s) => s.step_no === action.stepNo) ?? scenario.steps[context.actionIndex] ?? { instruction: action.rawStep };
  const assertions = await extractStepAssertions(action, step, payload, { stableRowLocator, resolvedLocator: locator });
  const assertionBlock = assertions.map(a => `  ${a.assertionCode}`).join('\n');

  if ((action.actionType === 'navigate' || action.actionType === 'click') && isSearchStep(action.rawStep)) {
    const searchValue = searchPayloadExpression(payload, action.rawStep, action.target);
    return `await test.step(${JSON.stringify(stepTitle)}, async () => {
  await ${locator}.fill(${searchValue});
${assertionBlock}
});`;
  }

  if (action.actionType === 'navigate' || action.actionType === 'click') {
    return `await test.step(${JSON.stringify(stepTitle)}, async () => {
  await ${locator}.click();
${assertionBlock}
});`;
  }

  if (action.actionType === 'fill') {
    const valueExpression = payloadValueExpressionForAction(action, payload);
    return `await test.step(${JSON.stringify(stepTitle)}, async () => {
  await ${locator}.fill(${valueExpression});
${assertionBlock}
});`;
  }

  if (action.actionType === 'select') {
    if (!isDropdownSelectAction(action, payload)) {
      const clickLocator = action.selectedLocator ?? action.dropdownLocator ?? locator;
      return `await test.step(${JSON.stringify(stepTitle)}, async () => {
  await ${clickLocator}.click();
${assertionBlock}
});`;
    }

    const dropdownLocator = dropdownOpenLocatorForAction(action, payload);
    const optionValueExpression = payloadValueExpressionForAction(action, payload);
    return `await test.step(${JSON.stringify(stepTitle)}, async () => {
  await selectCustomDropdown(page, () => ${dropdownLocator}, ${optionValueExpression});
${assertionBlock}
});`;
  }

  if (action.actionType === 'verify') {
    return `await test.step(${JSON.stringify(stepTitle)}, async () => {
  await expect(page.locator('body')).toBeVisible();
});`;
  }

  if (action.actionType === 'wait') {
    return `await test.step(${JSON.stringify(stepTitle)}, async () => {
  await page.waitForLoadState('networkidle').catch(() => undefined);
});`;
  }

  return `await test.step(${JSON.stringify(stepTitle)}, async () => {
  test.info().annotations.push({ type: 'recon', description: ${JSON.stringify(action.actionError ?? 'Unknown recon action skipped.')} });
});`;
}

function renderLoginPostAssertion(firstAction: ReconAction | undefined): string {
  if (firstAction?.selectedLocator) {
    return `    await expect(${firstAction.selectedLocator}).toBeVisible({ timeout: 15000 });`;
  }

  if (firstAction?.target) {
    const pattern = escapeRegexForLiteral(firstAction.target);
    return `    await expect(page.getByRole('button', { name: /${pattern}/i })).toBeVisible({ timeout: 15000 });`;
  }

  return `    await expect(page.locator('body')).toBeVisible({ timeout: 15000 });`;
}

function shouldSkipFailedReconStep(action: ReconAction, _payload: Record<string, unknown>): boolean {
  if (action.actionStatus !== 'failed') {
    return false;
  }

  if (action.selectedLocator || action.dropdownLocator) {
    return false;
  }

  return true;
}

function renderSkippedReconStep(stepTitle: string, action: ReconAction): string {
  const reason = action.actionError ?? 'Recon step failed; no reliable locator captured.';
  return `await test.step(${JSON.stringify(stepTitle)}, async () => {
  test.info().annotations.push({ type: 'recon-skip', description: ${JSON.stringify(reason)} });
});`;
}





function locatorForAction(action: ReconAction, payload: Record<string, unknown>, context: RenderContext): string {
  const searchLocator = resolveSearchInputLocator(action, context);
  if (searchLocator) {
    return searchLocator;
  }

  const stable = stableLocatorForAction(action, payload);
  if (stable) {
    return stable;
  }

  return fallbackLocator(action);
}

function resolveSearchInputLocator(action: ReconAction, context: RenderContext): string | null {
  if (!isSearchFieldAction(action)) {
    return null;
  }

  const priorPlaceholder = context.reconActions.find(
    (entry) => entry.selectedLocator && /getByPlaceholder/i.test(entry.selectedLocator) && /search/i.test(entry.selectedLocator)
  )?.selectedLocator;

  if (priorPlaceholder) {
    return priorPlaceholder;
  }

  const placeholderPattern = extractAccessibleNamePattern(action.selectedLocator);
  if (placeholderPattern) {
    return `page.getByPlaceholder(/${placeholderPattern}/i)`;
  }

  return `page.getByPlaceholder(/search by name or email/i)`;
}

function isSearchFieldAction(action: ReconAction): boolean {
  if (action.actionType !== 'fill' && !(action.actionType === 'click' && isSearchStep(action.rawStep))) {
    return false;
  }

  if (isSearchStep(action.rawStep)) {
    return true;
  }

  return isUnreliableSearchTextboxLocator(action.selectedLocator);
}

function isUnreliableSearchTextboxLocator(locator: string | null | undefined): boolean {
  if (!locator) {
    return false;
  }

  return /getByRole\(["']textbox["'],\s*\{\s*name:/i.test(locator) && /search/i.test(locator);
}

function extractAccessibleNamePattern(locator: string | null | undefined): string | null {
  if (!locator) {
    return null;
  }

  const match = locator.match(/name:\s*\/(.+)\/i/);
  return match?.[1] ?? null;
}

function stableLocatorForAction(action: ReconAction, payload: Record<string, unknown>): string | null {
  const rowLocator = stableUserRowLocatorExpression(payload, action);
  if (rowLocator) {
    return rowLocator;
  }

  if (action.selectedLocator && !isBrittleRowLocator(action.selectedLocator)) {
    if (action.actionStatus === 'failed' && isUnreliableSearchTextboxLocator(action.selectedLocator)) {
      return null;
    }

    if (isUnreliableSearchTextboxLocator(action.selectedLocator) && isSearchFieldAction(action)) {
      return null;
    }

    return action.selectedLocator;
  }

  return null;
}

function stableUserRowLocatorExpression(
  payload: Record<string, unknown>,
  action: ReconAction
): string | null {
  if (!isUserRowClickAction(action, payload)) {
    return null;
  }

  const sanitized = sanitizePayload(payload);
  const fullName = sanitized['Full Name'];
  const email = sanitized['Email Address'];

  if (fullName && email) {
    return `page.getByRole('row').filter({ hasText: ${JSON.stringify(fullName)} }).filter({ hasText: ${JSON.stringify(email)} })`;
  }

  if (fullName) {
    return `page.getByText(${regexLiteral(fullName)})`;
  }

  if (email) {
    return `page.getByText(${regexLiteral(email)})`;
  }

  return null;
}

function isUserRowClickAction(action: ReconAction, payload: Record<string, unknown>): boolean {
  if (action.actionType !== 'click' && action.actionType !== 'navigate') {
    return false;
  }

  if (isBrittleRowLocator(action.selectedLocator)) {
    return true;
  }

  const sanitized = sanitizePayload(payload);
  const fullName = sanitized['Full Name'];
  const target = action.target ?? '';

  return Boolean(fullName && normalizeKey(target) === normalizeKey(fullName));
}

function isBrittleRowLocator(locator: string | null | undefined): boolean {
  if (!locator) {
    return false;
  }

  if (!/getByRole\(["']row/i.test(locator)) {
    return false;
  }

  const nameMatch = locator.match(/name:\s*\/(.+)\/i\s*\}/);
  if (!nameMatch?.[1]) {
    return locator.length > 90;
  }

  const pattern = nameMatch[1];
  return pattern.length > 48 || /\d{4}-\d{2}-\d{2}/.test(pattern);
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function dropdownOpenLocatorForAction(action: ReconAction, payload: Record<string, unknown>): string {
  if (action.dropdownLocator) {
    return action.dropdownLocator;
  }

  if (action.selectedLocator && !isBrittleRowLocator(action.selectedLocator)) {
    return action.selectedLocator;
  }

  const target = action.target ?? 'Role';
  const pattern = escapeRegexForLiteral(target);
  return `page.getByText(/^Select ${pattern}$/i)`;
}

function fallbackLocator(action: ReconAction): string {
  const target = action.target ?? action.rawStep;
  const pattern = regexLiteral(target);

  if (action.actionType === 'fill') {
    return `page.getByRole('textbox', { name: ${pattern} })`;
  }

  if (action.actionType === 'select') {
    return `page.getByRole('combobox', { name: ${pattern} })`;
  }

  return `page.getByRole('button', { name: ${pattern} })`;
}

function regexLiteral(value: string): string {
  return `/${escapeRegexForLiteral(value)}/i`;
}



function indent(value: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return value
    .split('\n')
    .map((line) => (line ? `${prefix}${line}` : line))
    .join('\n');
}
