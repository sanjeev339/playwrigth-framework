import assert from 'node:assert/strict';
import { describe, it, vi, beforeEach } from 'vitest';
import { mapExpectedResultsToSteps } from '../../../src/scenario/expectationMapper';
import { callLLM } from '../../../src/llm/llmClient';
import type { NormalizedStep } from '../../../src/scenario/stepNormalizer';

vi.mock('../../../src/llm/llmClient', () => {
  return {
    callLLM: vi.fn()
  };
});

describe('expectationMapper', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const steps: NormalizedStep[] = [
    { step_no: 1, instruction: 'Navigate to User Management', raw_instruction: 'Navigate to User Management', expected_result: 'User Management page is displayed' },
    { step_no: 2, instruction: 'Click Search', raw_instruction: 'Click Search' },
    { step_no: 3, instruction: 'Select Edit', raw_instruction: 'Select Edit', expected_result: 'User details are displayed' },
    { step_no: 4, instruction: 'Select Role', raw_instruction: 'Select Role', expected_result: 'Role dropdown reflects the chosen role' },
    { step_no: 5, instruction: 'Click Save', raw_instruction: 'Click Save', expected_result: 'User status is updated to Deactivated; User role is updated successfully; Overall: User\'s assigned role reflects changes in the user list' }
  ];

  it('maps expected results using LLM', async () => {
    // Mock LLM to return mappings matching the expectedResultIndex to appropriate stepIndex
    const mockMappingResponse = JSON.stringify([
      { expectedResultIndex: 0, stepIndex: 0 }, // 'User Management page is displayed' -> 'Navigate to User Management'
      { expectedResultIndex: 1, stepIndex: 2 }, // 'User details are displayed' -> 'Select Edit'
      { expectedResultIndex: 2, stepIndex: 3 }, // 'Role dropdown reflects the chosen role' -> 'Select Role'
      { expectedResultIndex: 3, stepIndex: 4 }, // 'User status is updated to Deactivated' -> 'Click Save'
      { expectedResultIndex: 4, stepIndex: 4 }, // 'User role is updated successfully' -> 'Click Save'
      { expectedResultIndex: 5, stepIndex: 4 }  // 'Overall: User's assigned role reflects changes in the user list' -> 'Click Save'
    ]);
    vi.mocked(callLLM).mockResolvedValueOnce(mockMappingResponse);

    const result = await mapExpectedResultsToSteps(steps, {});

    assert.equal(result[0].expected_result, 'User Management page is displayed');
    assert.equal(result[1].expected_result, undefined);
    assert.equal(result[2].expected_result, 'User details are displayed');
    assert.equal(result[3].expected_result, 'Role dropdown reflects the chosen role');
    assert.equal(result[4].expected_result, 'User status is updated to Deactivated; User role is updated successfully; Overall: User\'s assigned role reflects changes in the user list');
  });

  it('falls back to heuristics mapping if LLM call throws or returns invalid JSON', async () => {
    vi.mocked(callLLM).mockRejectedValueOnce(new Error('LLM Error'));

    const result = await mapExpectedResultsToSteps(steps, {});

    // Heuristics:
    // 'User Management page is displayed' contains 'page is displayed' -> maps to step 0 ('Navigate to User Management')
    // 'User details are displayed' -> maps to step 2 ('Select Edit')
    // 'Role dropdown reflects the chosen role' -> maps to step 3 ('Select Role')
    // 'User status is updated to Deactivated' contains 'updated' -> maps to step 4 ('Click Save')
    // 'User role is updated successfully' contains 'updated' -> maps to step 4 ('Click Save')
    // 'Overall: User's assigned role reflects changes in the user list' contains 'role' -> maps to step 3 ('Select Role')
    assert.ok(result[0].expected_result?.includes('User Management page is displayed'));
    assert.ok(result[0].expected_result?.includes('User details are displayed'));
    assert.equal(result[1].expected_result, undefined);
    assert.equal(result[2].expected_result, undefined);
    assert.ok(result[3].expected_result?.includes('Role dropdown reflects the chosen role'));
    assert.ok(result[3].expected_result?.includes('Overall: User\'s assigned role reflects changes in the user list'));
    assert.ok(result[3].expected_result?.includes('User role is updated successfully'));
    assert.ok(result[4].expected_result?.includes('User status is updated to Deactivated'));
  });
});
