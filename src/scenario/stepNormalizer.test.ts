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

const editUserInput =
  '1. Navigate to User Management; 2.Click on the user and click on menu and select edit.; 3. Select role from Role dropdown; 4. Click on Save.';

const editPayload = {
  'First Name': 'Sample',
  'Last Name': 'User',
  'Full Name': 'Sample User',
  'Email Address': 'target.user@example.test',
  Role: 'Target Role'
};

const editNormalized = normalizeScenarioSteps([{ step_no: 1, instruction: editUserInput }], editPayload);
assert.deepEqual(
  editNormalized.map((step) => step.instruction),
  [
    'Navigate to User Management',
    'Click Actions Menu for target.user@example.test',
    'Click Edit',
    'Select Role',
    'Click Save'
  ]
);

console.log('row action step normalization passed');

const editUserWithoutMenuInput =
  '1. Navigate to User Management; 2.Click on the user and click on edit.; 3. Select role from Role dropdown; 4. Click on Save.';
const editUserWithoutMenuNormalized = normalizeScenarioSteps([{ step_no: 1, instruction: editUserWithoutMenuInput }], editPayload);
assert.deepEqual(
  editUserWithoutMenuNormalized.map((step) => step.instruction),
  [
    'Navigate to User Management',
    'Click Actions Menu for target.user@example.test',
    'Click Edit',
    'Select Role',
    'Click Save'
  ]
);

console.log('row action without explicit menu normalization passed');

const selectUserInput = '1. Navigate to User Management; 2. Select the user; 3. Click on Deactivate';
const selectUserNormalized = normalizeScenarioSteps([{ step_no: 1, instruction: selectUserInput }], editPayload);
assert.deepEqual(
  selectUserNormalized.map((step) => step.instruction),
  ['Navigate to User Management', 'Click Actions Menu for target.user@example.test', 'Click Deactivate']
);

console.log('generic select user normalization passed');

const genericRowActionInput =
  '1. Navigate to Accounts; 2. Click on the record and click on menu and select delete; 3. Click Confirm';

const genericRowPayload = {
  'Record ID': 'ACC-1001',
  Name: 'Acme Example',
  Status: 'Inactive'
};

const genericRowNormalized = normalizeScenarioSteps([{ step_no: 1, instruction: genericRowActionInput }], genericRowPayload);
assert.deepEqual(
  genericRowNormalized.map((step) => step.instruction),
  ['Navigate to Accounts', 'Click Actions Menu for ACC-1001', 'Click Delete', 'Click Confirm']
);

console.log('generic row action step normalization passed');

const noPayloadRowAction = normalizeScenarioSteps([
  { step_no: 1, instruction: 'Click on the customer and click on menu and select delete' }
]);
assert.deepEqual(noPayloadRowAction.map((step) => step.instruction), ['Click Actions Menu for record', 'Click Delete']);

console.log('generic row action fallback normalization passed');

const mixedCompoundInput = 'Enter Customer Name and select Status and click Save';
const mixedCompoundNormalized = normalizeScenarioSteps([{ step_no: 1, instruction: mixedCompoundInput }], {
  'Customer Name': 'Acme Corp',
  Status: 'Active'
});
assert.deepEqual(
  mixedCompoundNormalized.map((step) => step.instruction),
  ['Enter Customer Name', 'Select Status', 'Click Save']
);

console.log('mixed compound action normalization passed');

const customerFeatureInput =
  '1. Navigate to Customer Management; 2. Click on the customer and click on menu and select edit; 3. Enter Customer Name and select Status and click Save';
const customerFeaturePayload = {
  'Customer ID': 'CUST-1001',
  'Customer Name': 'Acme Corp',
  Status: 'Active'
};
const customerFeatureNormalized = normalizeScenarioSteps([{ step_no: 1, instruction: customerFeatureInput }], customerFeaturePayload);
assert.deepEqual(
  customerFeatureNormalized.map((step) => step.instruction),
  [
    'Navigate to Customer Management',
    'Click Actions Menu for CUST-1001',
    'Click Edit',
    'Enter Customer Name',
    'Select Status',
    'Click Save'
  ]
);

console.log('customer feature action normalization passed');
