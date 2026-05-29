import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { parseAction } from '../../../src/recon/actionParser';

describe('actionParser', () => {
  const editPayload = {
    'Full Name': 'adithya j',
    'Email Address': 'user@example.com',
    Role: 'Workflow Operators'
  };

  it('treats Select Edit as click', () => {
    const selectEdit = parseAction('Select Edit', editPayload);
    assert.equal(selectEdit.actionType, 'click');
    assert.equal(selectEdit.target, 'Edit');
  });

  it('keeps Select Role as dropdown select with value', () => {
    const selectRole = parseAction('Select Role', editPayload);
    assert.equal(selectRole.actionType, 'select');
    assert.equal(selectRole.value, 'Workflow Operators');
  });

  it('parses compound search step as fill with payload value', () => {
    const searchStep = parseAction('Click Search And Search The User Name', editPayload);
    assert.equal(searchStep.actionType, 'fill');
    assert.equal(searchStep.target, 'Full Name');
    assert.equal(searchStep.value, 'adithya j');
  });

  it('parses normalized search user step as fill', () => {
    const searchStep = parseAction('Search user by Full Name', editPayload);
    assert.equal(searchStep.actionType, 'fill');
    assert.equal(searchStep.target, 'Full Name');
    assert.equal(searchStep.value, 'adithya j');
  });

  it('enriches Click User to display name target', () => {
    const userStep = parseAction('Click User', editPayload);
    assert.equal(userStep.actionType, 'click');
    assert.equal(userStep.target, 'adithya j');
  });

  it('keeps Click Search as click on search control', () => {
    const focusStep = parseAction('Click Search', editPayload);
    assert.equal(focusStep.actionType, 'click');
    assert.equal(focusStep.target, 'Search');
  });
});
