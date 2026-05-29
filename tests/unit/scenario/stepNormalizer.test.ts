import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { normalizeScenarioSteps } from '../../../src/scenario/stepNormalizer';

describe('stepNormalizer', () => {
  it('splits chained instructions into atomic steps', () => {
    const input =
      '1. Navigate to User Management; 2. Click on Add User and click New Internal User; 3. Enter first Name and last Name; 4. Enter Email Address; 5. Select Role; 6. Click on Save';

    const payload = {
      'First Name': 'Riya',
      'Last Name': 'Sharma',
      'Email Address': 'Riya.sharma@piraiinfotech.com',
      Role: 'Executive'
    };

    const normalized = normalizeScenarioSteps([{ step_no: 1, instruction: input }], payload);
    const actual = normalized.map((step) => step.instruction);

    assert.deepEqual(actual, [
      'Navigate to User Management',
      'Click Add User',
      'Click New Internal User',
      'Enter First Name',
      'Enter Last Name',
      'Enter Email Address',
      'Select Role',
      'Click Save'
    ]);
    assert.equal(normalized[0].raw_instruction, input);
    assert.ok(normalized.some((step) => step.normalization_strategy === 'action_graph_chain_split'));
  });

  it('normalizes ambiguous chained steps without leftover "and"', () => {
    const payload = {
      'First Name': 'Riya',
      'Last Name': 'Sharma',
      'Email Address': 'Riya.sharma@piraiinfotech.com',
      Role: 'Executive'
    };
    const ambiguousInput =
      '1. Click user menu and edit role; 2. Open settings and change password; 3. Select admin and save changes';
    const ambiguousNormalized = normalizeScenarioSteps([{ step_no: 1, instruction: ambiguousInput }], payload).map(
      (step) => step.instruction
    );
    assert.equal(ambiguousNormalized.length, 5);
    assert.ok(!ambiguousNormalized.some((step) => /and/i.test(step)));
    assert.deepEqual(ambiguousNormalized.slice(-2), ['Select Admin', 'Click Save Changes']);
  });

  it('splits TC-UM-003 search compound and enriches Click User', () => {
    const input =
      '1. Navigate to User Management.; 2.Click on  search and search the user name.; 3. Click on User.; 4. select edit.; 5. Select the role from Role dropdown list.; 6. Click on Save.';

    const payload = {
      'First Name': 'adithya',
      'Last Name': 'j',
      'Full Name': 'adithya j',
      'Email Address': 'sanjeevkumar.m00@gmail.com',
      Role: 'Workflow Operators'
    };

    const normalized = normalizeScenarioSteps([{ step_no: 1, instruction: input }], payload).map(
      (step) => step.instruction
    );

    assert.deepEqual(normalized, [
      'Navigate to User Management',
      'Click Search',
      'Search user by Full Name',
      'Click adithya j',
      'Select Edit',
      'Select Role',
      'Click Save'
    ]);
    assert.ok(!normalized.some((step) => /Search And Search The User Name/i.test(step)));
  });
});
