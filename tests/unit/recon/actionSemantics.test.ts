import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  isSearchStep,
  resolvePayloadKeyForStep,
  searchPayloadExpression,
  shouldReclassifySelectAsClick
} from '../../../src/recon/actionSemantics';

describe('actionSemantics', () => {
  const payload = {
    'First Name': 'adithya',
    'Last Name': 'j',
    'Email Address': 'user@example.com',
    Role: 'Workflow Operators'
  };

  it('reclassifies Select Edit as click when no dropdown value', () => {
    assert.equal(shouldReclassifySelectAsClick('Edit', null, payload), true);
  });

  it('keeps Select Role as dropdown when payload has Role', () => {
    assert.equal(shouldReclassifySelectAsClick('Role', 'Workflow Operators', payload), false);
  });

  it('resolves search payload key from step text', () => {
    const key = resolvePayloadKeyForStep('Click Search And Search The User Name', 'Search', payload);
    assert.ok(key === 'Email Address' || key === 'First Name' || key === 'Full Name');
  });

  it('builds search expression from resolved payload key', () => {
    const expr = searchPayloadExpression(payload, 'Search user by email', 'Email Address');
    assert.equal(expr, 'String(payload["Email Address"])');
  });

  it('detects search steps', () => {
    assert.equal(isSearchStep('Click Search And Search The User Name'), true);
    assert.equal(isSearchStep('Navigate to Dashboard'), false);
  });
});
