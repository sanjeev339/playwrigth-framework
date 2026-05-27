import assert from 'node:assert/strict';
import { normalizeScenarioSteps } from './stepNormalizer';

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

console.log('stepNormalizer.test.ts passed');
