import type { Scenario, ReconSnapshot } from '../types';
import type { ReconAction } from '../recon/reconActionExtractor';
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
      'The reconAction list is the source of truth for locators.',
      'Do not invent generic locators when selectedLocator exists.',
      'Do not stop after login.',
      'Every action in reconAction must appear in the generated test.',
      'If actionStatus is failed for a select/dropdown step, generate robust custom dropdown fallback code using parsedAction.value.',
      '',
      'Hard rules:',
      '1. Use @playwright/test with TypeScript.',
      '2. Use test.step for login and for every reconAction.',
      '3. Use this safe login URL pattern:',
      '   const loginUrl = process.env.LOGIN_URL ?? process.env.WEBSITE_URL ?? build from APP_BASE_URL + LOGIN_PATH;',
      '   await page.goto(loginUrl);',
      '4. Never call page.goto(`${baseURL}/login/`).',
      '5. Never append /login/ manually when WEBSITE_URL is present.',
      '6. After login, assert stable post-login UI:',
      "   await expect(page.getByRole('button', { name: /User Management/i })).toBeVisible();",
      '7. For successful recon actions, use reconAction.selectedLocator exactly.',
      '8. For New Internal User, if recon selected Add Internal User, use:',
      '   page.getByText(/New Internal User|Add Internal User/i)',
      '9. For custom dropdowns, never use selectOption unless recon proves the element is a native select.',
      '10. For Role dropdown, click dropdownLocator or page.getByText(/^Select role$/i), then click option by payload value.',
      "11. Role option fallback must include page.locator('[role=\"listbox\"], .p-dropdown-panel, .p-dropdown-items').getByText(/^VALUE$/i).",
      '12. Use payload values for business fields.',
      '13. Never hardcode login credentials; use process.env.LOGIN_EMAIL and process.env.LOGIN_PASSWORD.',
      '14. Output full code only. No Markdown. No explanation.',
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

export function buildDeterministicReconTest(scenario: Scenario, reconActions: ReconAction[]): string {
  const title = `${scenario.scenario_id}: ${scenario.action ?? scenario.module ?? 'Generated scenario'}`;
  const payloadLiteral = JSON.stringify(scenario.payload, null, 2).replace(/\n/g, '\n  ');
  const actionSteps = reconActions.map((action) => renderActionStep(action, scenario.payload)).join('\n\n');

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
  await openDropdown().click();

  const exactOptionRegex = new RegExp(\`^\${escapeRegex(optionValue)}$\`, 'i');
  const optionCandidates = [
    page.getByRole('option', { name: exactOptionRegex }),
    page.locator('[role="listbox"], .p-dropdown-panel, .p-dropdown-items').getByText(exactOptionRegex),
    page.locator('li[role="option"]').filter({ hasText: exactOptionRegex }),
    page.getByText(exactOptionRegex)
  ];

  for (const locator of optionCandidates) {
    const candidate = await firstUsable(locator);
    if (candidate) {
      await candidate.click();
      await expect(page.getByText(exactOptionRegex).first()).toBeVisible({ timeout: 5000 });
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

    await expect(page.getByRole('button', { name: /User Management/i })).toBeVisible({ timeout: 15000 });
  });

${indent(actionSteps, 2)}
});
`;
}

function renderActionStep(action: ReconAction, payload: Record<string, unknown>): string {
  const stepTitle = `Step ${action.stepNo ?? '?'}: ${action.rawStep}`;
  const locator = locatorForAction(action);
  const valueExpression = payloadValueExpression(action, payload);

  if (action.actionType === 'navigate' || action.actionType === 'click') {
    return `await test.step(${JSON.stringify(stepTitle)}, async () => {
  await ${locator}.click();
${renderClickAssertion(action)}
});`;
  }

  if (action.actionType === 'fill') {
    return `await test.step(${JSON.stringify(stepTitle)}, async () => {
  await ${locator}.fill(${valueExpression});
  await expect(${locator}).toHaveValue(${valueExpression});
});`;
  }

  if (action.actionType === 'select') {
    const dropdownLocator = dropdownLocatorForAction(action);
    const optionValueExpression = payloadValueExpression(action, payload);
    return `await test.step(${JSON.stringify(stepTitle)}, async () => {
  await selectCustomDropdown(page, () => ${dropdownLocator}, ${optionValueExpression});
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

function renderClickAssertion(action: ReconAction): string {
  if (/user management/i.test(action.rawStep)) {
    return "  await expect(page.getByRole('button', { name: /Add User/i })).toBeVisible({ timeout: 15000 });";
  }
  if (/add user/i.test(action.rawStep)) {
    return '  await expect(page.getByText(/New Internal User|Add Internal User/i)).toBeVisible({ timeout: 10000 });';
  }
  if (/new internal user/i.test(action.rawStep)) {
    return '  await expect(page.getByRole(\'textbox\', { name: /Enter first name/i })).toBeVisible({ timeout: 10000 });';
  }
  if (/save/i.test(action.rawStep)) {
    return "  await page.waitForLoadState('networkidle').catch(() => undefined);";
  }
  return "  await page.waitForLoadState('domcontentloaded').catch(() => undefined);";
}

function locatorForAction(action: ReconAction): string {
  if (/new internal user/i.test(action.rawStep)) {
    return 'page.getByText(/New Internal User|Add Internal User/i)';
  }

  return action.selectedLocator ?? fallbackLocator(action);
}

function dropdownLocatorForAction(action: ReconAction): string {
  if (/role/i.test(action.target ?? action.rawStep)) {
    return 'page.getByText(/^Select role$/i)';
  }

  return action.dropdownLocator ?? action.selectedLocator ?? fallbackLocator(action);
}

function fallbackLocator(action: ReconAction): string {
  const target = action.target ?? action.rawStep;
  const pattern = regexLiteral(target);

  if (action.actionType === 'fill') {
    return `page.getByRole('textbox', { name: ${pattern} })`;
  }

  if (action.actionType === 'select') {
    return `page.getByText(${pattern})`;
  }

  return `page.getByText(${pattern})`;
}

function payloadValueExpression(action: ReconAction, payload: Record<string, unknown>): string {
  const target = action.target;
  if (target && Object.prototype.hasOwnProperty.call(payload, target)) {
    return `String(payload[${JSON.stringify(target)}])`;
  }

  const matchingKey = Object.keys(payload).find((key) => String(payload[key]) === String(action.selectedValue ?? action.value ?? ''));
  if (matchingKey) {
    return `String(payload[${JSON.stringify(matchingKey)}])`;
  }

  return JSON.stringify(String(action.selectedValue ?? action.value ?? ''));
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
