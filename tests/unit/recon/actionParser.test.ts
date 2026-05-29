import assert from 'node:assert/strict';
import { parseAction } from '../../../src/recon/actionParser';

const payload = {
  Role: 'Admin',
  'First Name': 'Riya',
  Status: 'Active'
};

const cases = [
  {
    name: 'single click parses cleanly',
    step: 'Click Save',
    expected: { actionType: 'click', target: 'Save', parseStatus: 'ok' as const }
  },
  {
    name: 'chained mixed verbs become ambiguous',
    step: 'Click and select edit',
    expected: {
      actionType: 'click',
      target: 'edit',
      parseStatus: 'ambiguous' as const,
      parseReason: 'multi_action_chain_target_inferred'
    }
  },
  {
    name: 'missing click target is failed parse',
    step: 'Click on menu and select',
    expected: { actionType: 'click', parseStatus: 'failed' as const, parseReason: 'missing_target' }
  },
  {
    name: 'payload-backed select resolves target and value',
    step: 'Select role from Role dropdown',
    expected: { actionType: 'select', target: 'Role', parseStatus: 'ok' as const, value: 'Admin' }
  },
  {
    name: 'payload-backed fill resolves key',
    step: 'Enter First Name',
    expected: { actionType: 'fill', target: 'First Name', parseStatus: 'ok' as const, value: 'Riya' }
  },
  {
    name: 'navigate parses as route intent',
    step: 'Navigate to User Management',
    expected: { actionType: 'navigate', target: 'User Management', parseStatus: 'ok' as const }
  }
];

for (const testCase of cases) {
  const parsed = parseAction(testCase.step, payload);
  assert.equal(parsed.actionType, testCase.expected.actionType, testCase.name);
  if ('target' in testCase.expected) {
    assert.equal(parsed.target, testCase.expected.target, testCase.name);
  }
  if ('value' in testCase.expected) {
    assert.equal(parsed.value, testCase.expected.value, testCase.name);
  }
  assert.equal(parsed.parseStatus, testCase.expected.parseStatus, testCase.name);
  if ('parseReason' in testCase.expected) {
    assert.equal(parsed.parseReason, testCase.expected.parseReason, testCase.name);
  }
}

console.log('actionParser.test.ts passed');
