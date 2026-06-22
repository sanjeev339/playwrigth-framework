import type { Scenario, ReconSnapshot } from '../types';
import type { ReconAction } from '../recon/reconActionExtractor';
import { truncate } from '../utils/fileUtils';

export function buildGeneratorPrompt(input: {
  scenario: Scenario;
  reconActions: ReconAction[];
  dropdownSnapshots: CompactDropdownSnapshot[];
}): string {
  const moduleName = input.scenario.module ?? 'UnknownModule';
  const pageClassName = moduleName.replace(/[^a-zA-Z0-9]/g, '') + 'Page';

  return truncate(
    [
      'You are an expert TypeScript Playwright test generator.',
      '',
      'You MUST generate the Playwright test from the provided reconAction list.',
      'The reconAction list is the source of truth for locators.',
      'Do not invent generic locators when selectedLocator exists.',
      'Every action in reconAction must appear in the generated test.',
      '',
      'Hard rules for the new 5-layer architecture:',
      '1. Import test and expect from "../fixtures" (NOT from "@playwright/test").',
      `2. Import the page object: import { ${pageClassName} } from "../pages";`,
      '3. Import faker builder: import { buildPayload } from "../data/fakerFactory";',
      '4. Initialize payload dynamically:',
      `   const payload = buildPayload("<scenario_id>", { ...originalPayload }, { dataStrategy: "<data_strategy>" });`,
      '5. Extract test arguments using fixtures: `test("Title", async ({ page }) => {`',
      `6. Instantiate the page object: const ${pageClassName.charAt(0).toLowerCase() + pageClassName.slice(1)} = new ${pageClassName}(page);`,
      '7. DO NOT write helper functions inline. They belong in the actions/ layer.',
      '8. DO NOT write a login test.step. The fixtures handle login via storageState automatically.',
      '9. DO NOT invent or hallucinate page object methods. The page object classes are currently empty. You MUST use inline Playwright commands with the provided recon locators for all actions (e.g. `await page.getByRole(...).click()`).',
      '10. Use payload values for business fields (e.g., `payload["First Name"]`).',
      '11. DO NOT generate `expect(page).toHaveURL()` assertions. They are brittle and cause false positives. Wait for elements to be visible instead.',
      '12. When selecting options from a dropdown (like Role), use exact string matching (e.g., `getByRole("option", { name: payload["Role"], exact: true })`) to avoid matching buttons outside the dropdown.',
      '13. Do not write assertions that strictly look for literal strings from the "Expected Results" column (like "success toast reads..."). Instead, assert that a success element is visible using generic roles like `await expect(page.getByRole("status")).toBeVisible();` or `await expect(page.locator(".toast-success")).toBeVisible();`.',
      '14. After clicking "Save" or "Submit", always include `await page.waitForLoadState("networkidle").catch(() => undefined);` before making assertions to ensure the server response has processed.',
      '15. Output full code only. No Markdown. No explanation.',
      '',
      'Scenario JSON:',
      JSON.stringify(input.scenario, null, 2),
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
  const moduleName = scenario.module ?? 'UnknownModule';
  const pageClassName = moduleName.replace(/[^a-zA-Z0-9]/g, '') + 'Page';
  const pageVarName = pageClassName.charAt(0).toLowerCase() + pageClassName.slice(1);
  const title = `${scenario.scenario_id}: ${scenario.action ?? scenario.module ?? 'Generated scenario'}`;
  const payloadLiteral = JSON.stringify(scenario.payload, null, 2).replace(/\n/g, '\n  ');
  const dataStrategy = scenario.metadata?.data_strategy ?? '';

  const actionSteps = reconActions
    .map((action, index) => renderActionStep(action, scenario.payload, reconActions[index - 1]))
    .join('\n\n');

  let processedActionSteps = actionSteps;

  // Append a placeholder for Expected Results since the deterministic generator cannot write custom assertions
  if (scenario.expected_results && scenario.expected_results.length > 0) {
    const expectedResultsText = scenario.expected_results.join(' ').replace(/\n/g, ' ');
    processedActionSteps += `\n\n  await test.step("Verify Expected Results: ${expectedResultsText}", async () => {\n    // TODO: Implement deterministic or manual assertion for expected results.\n    // Expected: ${expectedResultsText}\n  });`;
  }

  return `import { test, expect } from '../fixtures';
import { ${pageClassName} } from '../pages';
import { buildPayload } from '../data/fakerFactory';
import { selectCustomDropdown, clickMenuItemAfterRowAction } from '../actions';

test(${JSON.stringify(title)}, async ({ page }) => {
  const ${pageVarName} = new ${pageClassName}(page);
  const payload = buildPayload(
    ${JSON.stringify(scenario.scenario_id)},
    ${payloadLiteral},
    { dataStrategy: ${JSON.stringify(dataStrategy)} }
  );

${indent(processedActionSteps, 2)}
});
`;
}

function renderActionStep(action: ReconAction, payload: Record<string, unknown>, previousAction?: ReconAction): string {
  const stepTitle = `Step ${action.stepNo ?? '?'}: ${action.rawStep}`;

  const hasLocator = action.selectedLocator || action.rowActionLocator || action.dropdownLocator;
  if (action.actionStatus === 'skipped' || (!hasLocator && !['verify', 'wait', 'unknown'].includes(action.actionType))) {
    return `await test.step(${JSON.stringify(stepTitle)}, async () => {
  test.info().annotations.push({ type: 'recon', description: ${JSON.stringify(action.actionError ?? 'Action skipped or missing locator from recon.')} });
});`;
  }

  const locator = locatorForAction(action);
  const valueExpression = payloadValueExpression(action, payload);

  if (action.actionType === 'navigate' || action.actionType === 'click' || action.actionType === 'row_action') {
    const previousRowMenuLocator =
      previousAction?.actionType === 'row_action'
        ? previousAction.rowActionLocator ?? previousAction.selectedLocator
        : null;

    if (action.actionType === 'click' && previousRowMenuLocator && action.selectedLocator) {
      return `await test.step(${JSON.stringify(stepTitle)}, async () => {
  await clickMenuItemAfterRowAction(${JSON.stringify(action.rawStep)}, () => ${previousRowMenuLocator}, () => ${locator});
${renderClickAssertion(action)}
});`;
    }

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
  if (action.actionType === 'row_action') {
    return '  await page.waitForTimeout(150);';
  }

  if (/save|submit|create|update|confirm|finish|done/i.test(action.rawStep)) {
    return "  await page.waitForLoadState('networkidle').catch(() => undefined);";
  }
  return "  await page.waitForLoadState('domcontentloaded').catch(() => undefined);";
}

function locatorForAction(action: ReconAction): string {
  if (action.actionType === 'row_action' && action.rowActionLocator) {
    return action.rowActionLocator;
  }

  if (!action.selectedLocator) {
    if (action.actionType === 'unknown' || action.actionType === 'verify' || action.actionType === 'wait') {
      // No locator found during recon — emit a visible body assertion so the test still compiles
      return `page.locator('body')`;
    }
    throw new Error(`Missing recon locator for ${action.actionType} step: ${action.rawStep}`);
  }

  return action.selectedLocator;
}

function dropdownLocatorForAction(action: ReconAction): string {
  const locator = action.dropdownLocator ?? action.selectedLocator;
  if (!locator) {
    throw new Error(`Missing recon dropdown locator for step: ${action.rawStep}`);
  }

  return locator;
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

function renderPostLoginAssertion(reconActions: ReconAction[]): string {
  return "";
}

function indent(value: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return value
    .split('\n')
    .map((line) => (line ? `${prefix}${line}` : line))
    .join('\n');
}
