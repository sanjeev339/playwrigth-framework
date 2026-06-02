import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { extractStepAssertions } from '../../../src/recon/assertionExtractor';
import type { ReconAction } from '../../../src/recon/reconActionExtractor';
import type { ScenarioStep } from '../../../src/types';
import { callLLM } from '../../../src/llm/llmClient';

vi.mock('../../../src/llm/llmClient', () => {
  return {
    callLLM: vi.fn().mockResolvedValue('await expect(page.getByText("Custom Assertion")).toBeVisible();')
  };
});

describe('assertionExtractor', () => {
  const payload = {
    'Email Address': 'user@example.com',
    'Full Name': 'Adithya J'
  };

  it('extracts URL assertion when postActionUrl is present', async () => {
    const action: ReconAction = {
      scenarioId: 'TC-UM-003',
      rawStep: 'Navigate to page',
      actionType: 'click',
      target: 'Link',
      value: null,
      selectedLocator: 'page.getByRole("link")',
      selectedValue: null,
      actionStatus: 'success',
      decisionSource: 'deterministic',
      postActionUrl: 'https://example.com/user-detail/1234',
      snapshotFile: 'step-1-after.json'
    };

    const step: ScenarioStep = {
      instruction: 'Navigate to page'
    };

    const assertions = await extractStepAssertions(action, step, payload);
    const urlAssertion = assertions.find(a => a.type === 'url');
    assert.ok(urlAssertion);
    assert.equal(urlAssertion?.assertionCode, 'await expect(page).toHaveURL(/user-detail/i, { timeout: 15000 });');
  });

  it('extracts landmark assertion when postActionLandmarkLocator is present', async () => {
    const action: ReconAction = {
      scenarioId: 'TC-UM-003',
      rawStep: 'Click Button',
      actionType: 'click',
      target: 'Button',
      value: null,
      selectedLocator: 'page.getByRole("button")',
      selectedValue: null,
      actionStatus: 'success',
      decisionSource: 'deterministic',
      postActionLandmarkLocator: 'page.getByRole("heading", { name: "User Profile" })',
      snapshotFile: 'step-2-after.json'
    };

    const step: ScenarioStep = {
      instruction: 'Click Button'
    };

    const assertions = await extractStepAssertions(action, step, payload);
    const landmarkAssertion = assertions.find(a => a.type === 'landmark');
    assert.ok(landmarkAssertion);
    assert.equal(landmarkAssertion?.assertionCode, 'await expect(page.getByRole("heading", { name: "User Profile" })).toBeVisible({ timeout: 15000 });');
  });

  it('extracts input_value assertion for fill actions', async () => {
    const action: ReconAction = {
      scenarioId: 'TC-UM-003',
      rawStep: 'Enter Email',
      actionType: 'fill',
      target: 'Email Address',
      value: 'user@example.com',
      selectedLocator: 'page.getByLabel("Email")',
      selectedValue: null,
      actionStatus: 'success',
      decisionSource: 'deterministic',
      snapshotFile: 'step-3-after.json'
    };

    const step: ScenarioStep = {
      instruction: 'Enter Email'
    };

    const assertions = await extractStepAssertions(action, step, payload);
    const inputValAssertion = assertions.find(a => a.type === 'input_value');
    assert.ok(inputValAssertion);
    assert.equal(inputValAssertion?.assertionCode, 'await expect(page.getByLabel("Email")).toHaveValue(String(payload["Email Address"]));');
  });

  it('extracts custom LLM-translated expected results', async () => {
    const action: ReconAction = {
      scenarioId: 'TC-UM-003',
      rawStep: 'Deactivate',
      actionType: 'click',
      target: 'Deactivate button',
      value: null,
      selectedLocator: 'page.getByRole("button", { name: "Deactivate" })',
      selectedValue: null,
      actionStatus: 'success',
      decisionSource: 'deterministic',
      snapshotFile: 'step-4-after.json'
    };

    const step: ScenarioStep = {
      instruction: 'Deactivate user',
      expected_result: 'User status is updated to Deactivated'
    };

    const assertions = await extractStepAssertions(action, step, payload);
    const customAssertion = assertions.find(a => a.type === 'custom');
    assert.ok(customAssertion);
    assert.equal(customAssertion?.assertionCode, 'await expect(page.getByText("Custom Assertion")).toBeVisible({ timeout: 15000 });');
  });

  it('gates/discards assertions when elements do not exist in post-action snapshot', async () => {
    const mockSnapshotPath = 'tests/fixtures/recon-actions/gating-test-snapshot.json';
    const mockSnapshotContent = {
      elements: [
        {
          isVisible: true,
          role: 'button',
          name: 'Save',
          text: 'Save',
          suggestedLocator: 'page.getByRole("button", { name: /Save/i })'
        }
      ]
    };
    mkdirSync(dirname(mockSnapshotPath), { recursive: true });
    writeFileSync(mockSnapshotPath, JSON.stringify(mockSnapshotContent, null, 2));

    try {
      const action: ReconAction = {
        scenarioId: 'TC-UM-003',
        rawStep: 'Save details',
        actionType: 'click',
        target: 'Save button',
        value: null,
        selectedLocator: 'page.getByRole("button", { name: /Save/i })',
        selectedValue: null,
        actionStatus: 'success',
        decisionSource: 'deterministic',
        snapshotFile: mockSnapshotPath
      };

      const step: ScenarioStep = {
        instruction: 'Click Save',
        expected_result: 'Save button is visible'
      };

      // Mock LLM translation to return one existing element and one non-existing element
      vi.mocked(callLLM).mockResolvedValueOnce(
        'await expect(page.getByRole("button", { name: /Save/i })).toBeVisible();\nawait expect(page.getByRole("button", { name: /Delete/i })).toBeVisible();'
      );

      const assertions = await extractStepAssertions(action, step, payload);

      // Only the Save button assertion should remain. Delete button assertion should be gated.
      // The LLM-produced Save assertion is deduped against the structural visibility assertion.
      assert.equal(assertions.length, 1);
      assert.ok(assertions.some(a => a.assertionCode.includes('Save')));
      assert.ok(!assertions.some(a => a.assertionCode.includes('Delete')));
    } finally {
      try {
        unlinkSync(mockSnapshotPath);
      } catch {
        // ignore
      }
    }
  });
});
