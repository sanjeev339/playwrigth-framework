import assert from 'node:assert/strict';
import { normalizeScenarioSteps } from '../../../src/scenario/stepNormalizer';

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

const expected = [
  'Navigate to User Management',
  'Click Add User',
  'Click New Internal User',
  'Enter First Name',
  'Enter Last Name',
  'Enter Email Address',
  'Select Role',
  'Click Save'
];

assert.deepEqual(actual, expected);
assert.equal(normalized[0].raw_instruction, input);
assert.deepEqual(
  normalized.map((step) => step.step_no),
  [1, 2, 3, 4, 5, 6, 7, 8]
);
assert.ok(normalized.some((step) => step.normalization_strategy === 'action_graph_chain_split'));

const ambiguousInput = '1. Click user menu and edit role; 2. Open settings and change password; 3. Select admin and save changes';
const ambiguousNormalized = normalizeScenarioSteps([{ step_no: 1, instruction: ambiguousInput }], payload).map(
  (step) => step.instruction
);
assert.equal(ambiguousNormalized.length, 5);
assert.ok(!ambiguousNormalized.some((step) => /and/i.test(step)));
assert.deepEqual(ambiguousNormalized.slice(-2), ['Select Admin', 'Click Save Changes']);

console.log('stepNormalizer.test.ts passed');
