import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { ReconAction } from '../../../src/recon/reconActionExtractor';
import { validateGeneratedReconTest } from '../../../src/llm/validateGeneratedReconTest';
import type { Scenario } from '../../../src/types';

const editScenario: Scenario = {
  scenario_id: 'TC-UM-003',
  module: 'User Management',
  raw_steps: [],
  steps: [],
  expected_results: [],
  payload: {
    'Full Name': 'adithya j',
    'Email Address': 'user@example.com',
    Role: 'Workflow Operators'
  },
  metadata: {
    execution_order: 1,
    data_strategy: 'positive_valid_update',
    edge_case_type: null,
    created_at: '2026-01-01T00:00:00.000Z',
    source_excel: 'input/test_flow.xlsx',
    source_json: 'input/test_data.json'
  }
};

const editReconActions: ReconAction[] = [
  {
    scenarioId: 'TC-UM-003',
    stepNo: 1,
    rawStep: 'Navigate to User Management',
    actionType: 'navigate',
    target: 'User Management',
    value: null,
    selectedLocator: 'page.getByRole("button", { name: /User Management/i })',
    selectedValue: null,
    actionStatus: 'success',
    decisionSource: 'deterministic',
    snapshotFile: 'recon/TC-UM-003/04-step-1-after.json',
    postActionUrl: 'https://app.example.com/users/list'
  },
  {
    scenarioId: 'TC-UM-003',
    stepNo: 4,
    rawStep: 'Select Edit',
    actionType: 'click',
    target: 'Edit',
    value: null,
    selectedLocator: 'page.getByRole("button", { name: /Edit/i })',
    selectedValue: null,
    actionStatus: 'failed',
    decisionSource: 'llm',
    snapshotFile: 'recon/TC-UM-003/10-step-4-after.json'
  },
  {
    scenarioId: 'TC-UM-003',
    stepNo: 5,
    rawStep: 'Select Role',
    actionType: 'select',
    target: 'Role',
    value: 'Workflow Operators',
    selectedLocator: null,
    selectedValue: 'Workflow Operators',
    actionStatus: 'failed',
    decisionSource: 'llm',
    snapshotFile: 'recon/TC-UM-003/12-step-5-after.json'
  }
];

describe('validateGeneratedReconTest', () => {
  it('accepts edit-flow generated code', () => {
    const editCode = `
test('edit', async () => {
  await test.step('Step 1: Navigate to User Management', async () => {
    await page.getByRole("button", { name: /User Management/i }).click();
  });
  await test.step('Step 4: Select Edit', async () => {
    await page.getByRole("button", { name: /Edit/i }).click();
  });
  await test.step('Step 5: Select Role', async () => {
    await selectCustomDropdown(page, () => page.getByText(/^Select role$/i), String(payload["Role"]));
  });
});
`;
    validateGeneratedReconTest(editCode, editScenario, editReconActions);
  });

  it('rejects empty selectCustomDropdown option', () => {
    assert.throws(
      () => validateGeneratedReconTest('await selectCustomDropdown(page, () => page.getByRole("button"), "");', editScenario, []),
      /empty option value/
    );
  });

  it('accepts add-user flow with fill steps', () => {
    const addScenario: Scenario = {
      ...editScenario,
      scenario_id: 'TC-ADD-001',
      payload: {
        'First Name': 'Riya',
        'Last Name': 'Sharma',
        'Email Address': 'riya@example.com',
        Role: 'Executive'
      }
    };

    const addReconActions: ReconAction[] = [
      {
        scenarioId: 'TC-ADD-001',
        stepNo: 1,
        rawStep: 'Navigate to User Management',
        actionType: 'navigate',
        target: 'User Management',
        value: null,
        selectedLocator: 'page.getByRole("button", { name: /User Management/i })',
        selectedValue: null,
        actionStatus: 'success',
        decisionSource: 'deterministic',
        snapshotFile: 'recon/x.json'
      },
      {
        scenarioId: 'TC-ADD-001',
        stepNo: 5,
        rawStep: 'Enter First Name',
        actionType: 'fill',
        target: 'First Name',
        value: 'Riya',
        selectedLocator: "page.getByRole('textbox', { name: /first name/i })",
        selectedValue: 'Riya',
        actionStatus: 'success',
        decisionSource: 'deterministic',
        snapshotFile: 'recon/x.json'
      }
    ];

    const addCode = `
await test.step('Step 1: Navigate to User Management', async () => {
  await page.getByRole("button", { name: /User Management/i }).click();
});
await test.step('Step 5: Enter First Name', async () => {
  await page.getByRole('textbox', { name: /first name/i }).fill('Riya');
});
`;
    validateGeneratedReconTest(addCode, addScenario, addReconActions);
  });
});
