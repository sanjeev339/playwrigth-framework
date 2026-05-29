import type { Scenario, ReconSnapshot } from '../types';
import type { ReconAction } from '../recon/reconActionExtractor';
import {
  isDropdownSelectAction,
  isSearchStep,
  payloadValueExpressionForAction,
  searchPayloadExpression
} from '../recon/actionSemantics';
import { truncate } from '../utils/fileUtils';

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
      '2. Use test.step for login and for every reconAction.',
      '3. Use this safe login URL pattern:',
      '   const loginUrl = process.env.LOGIN_URL ?? process.env.WEBSITE_URL ?? build from APP_BASE_URL + LOGIN_PATH;',
      '   await page.goto(loginUrl);',
      '4. Never call page.goto(`${baseURL}/login/`).',
      '5. Never append /login/ manually when WEBSITE_URL is present.',
      '6. After login, assert visibility of the first recon action selectedLocator (from reconActions[0]).',
      '7. For successful recon actions, use reconAction.selectedLocator exactly.',
      '8. For custom dropdowns, never use selectOption unless recon proves a native select element.',
      '9. For failed select steps, use dropdownLocator + optionValue from recon and dropdown-open snapshot elements.',
      '10. Use payload values from scenario JSON only via payload[KEY] expressions.',
      '11. Search steps must fill the search field using payload, not only click the placeholder.',
      '12. Derive post-step assertions from postActionUrl or postActionLandmarkLocator on each reconAction when present.',
      '13. Never call selectCustomDropdown with an empty option value.',
      '14. Use { timeout: 15000 } on post-navigation expect().toBeVisible() / toHaveURL() assertions.',
      '15. Output full code only. No Markdown. No explanation.',
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

export function buildDeterministicReconTest(scenario: Scenario, reconActions: ReconAction[]): string {
  const title = `${scenario.scenario_id}: ${scenario.action ?? scenario.module ?? 'Generated scenario'}`;
  const payloadLiteral = JSON.stringify(scenario.payload, null, 2).replace(/\n/g, '\n  ');
  const actionSteps = reconActions
    .map((action, actionIndex) =>
      renderActionStep(action, scenario.payload, {
        reconActions,
        actionIndex
      })
    )
    .join('\n\n');
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

function renderActionStep(action: ReconAction, payload: Record<string, unknown>, context: RenderContext): string {
  const stepTitle = `Step ${action.stepNo ?? '?'}: ${action.rawStep}`;
  const locator = locatorForAction(action);
  const nextAction = context.reconActions[context.actionIndex + 1];

  if ((action.actionType === 'navigate' || action.actionType === 'click') && isSearchStep(action.rawStep)) {
    const searchValue = searchPayloadExpression(payload, action.rawStep, action.target);
    const followUpAssertion = renderSearchFollowUpAssertion(nextAction, payload);
    return `await test.step(${JSON.stringify(stepTitle)}, async () => {
  await ${locator}.fill(${searchValue});
${followUpAssertion}
});`;
  }

  if (action.actionType === 'navigate' || action.actionType === 'click') {
    return `await test.step(${JSON.stringify(stepTitle)}, async () => {
  await ${locator}.click();
${renderPostActionAssertion(action)}
});`;
  }

  if (action.actionType === 'fill') {
    const valueExpression = payloadValueExpressionForAction(action, payload);
    return `await test.step(${JSON.stringify(stepTitle)}, async () => {
  await ${locator}.fill(${valueExpression});
  await expect(${locator}).toHaveValue(${valueExpression});
});`;
  }

  if (action.actionType === 'select') {
    if (!isDropdownSelectAction(action, payload)) {
      const clickLocator = action.selectedLocator ?? action.dropdownLocator ?? locator;
      return `await test.step(${JSON.stringify(stepTitle)}, async () => {
  await ${clickLocator}.click();
${renderPostActionAssertion(action)}
});`;
    }

    const dropdownLocator = dropdownOpenLocatorForAction(action);
    const optionValueExpression = payloadValueExpressionForAction(action, payload);
    return `await test.step(${JSON.stringify(stepTitle)}, async () => {
  await selectCustomDropdown(page, () => ${dropdownLocator}, ${optionValueExpression});
${renderPostActionAssertion(action)}
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

function renderPostActionAssertion(action: ReconAction): string {
  const urlAssertion = urlAssertionFromPostActionUrl(action.postActionUrl);
  if (urlAssertion) {
    return urlAssertion;
  }

  if (action.postActionLandmarkLocator) {
    return `  await expect(${action.postActionLandmarkLocator}).toBeVisible({ timeout: 15000 });`;
  }

  if (action.selectedLocator && action.actionStatus === 'success') {
    return `  await expect(${action.selectedLocator}).toBeVisible({ timeout: 15000 });`;
  }

  return "  await page.waitForLoadState('domcontentloaded').catch(() => undefined);";
}

function renderSearchFollowUpAssertion(nextAction: ReconAction | undefined, payload: Record<string, unknown>): string {
  if (nextAction?.selectedLocator) {
    return `  await expect(${nextAction.selectedLocator}).toBeVisible({ timeout: 15000 });`;
  }

  const key = Object.keys(payload).find((entry) => {
    const value = String(payload[entry] ?? '');
    return value.length > 0 && !/^(true|false)$/i.test(value);
  });

  if (key) {
    return `  await expect(page.getByText(String(payload[${JSON.stringify(key)}]))).toBeVisible({ timeout: 15000 });`;
  }

  return "  await page.waitForLoadState('domcontentloaded').catch(() => undefined);";
}

function urlAssertionFromPostActionUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/').filter(Boolean);
    const anchor = segments[segments.length - 1];
    if (!anchor) {
      return null;
    }

    const escaped = escapeRegexForLiteral(anchor);
    return `  await expect(page).toHaveURL(/${escaped}/i, { timeout: 15000 });`;
  } catch {
    return null;
  }
}

function locatorForAction(action: ReconAction): string {
  return action.selectedLocator ?? fallbackLocator(action);
}

function dropdownOpenLocatorForAction(action: ReconAction): string {
  if (action.dropdownLocator) {
    return action.dropdownLocator;
  }

  if (action.selectedLocator) {
    return action.selectedLocator;
  }

  return fallbackLocator(action);
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

function escapeRegexForLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '\\/');
}

function indent(value: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return value
    .split('\n')
    .map((line) => (line ? `${prefix}${line}` : line))
    .join('\n');
}
