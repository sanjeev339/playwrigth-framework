import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { DomElementSnapshot } from '../../../src/types';
import { resolveDeterministicCandidates } from '../../../src/recon/deterministicLocatorResolver';
import type { ParsedAction } from '../../../src/recon/reconDecisionTypes';

function rowElement(text: string): DomElementSnapshot {
  return {
    index: 1,
    tag: 'tbody',
    text,
    role: ' rowgroup',
    isVisible: true,
    isEnabled: true,
    isLikelyClickable: false,
    structuredLocatorPriority: [
      {
        method: 'getByRole',
        role: 'rowgroup',
        name: text,
        exact: false
      },
      {
        method: 'getByText',
        text,
        exact: false
      }
    ]
  } as DomElementSnapshot;
}

function searchInputElement(): DomElementSnapshot {
  return {
    index: 2,
    tag: 'input',
    type: 'text',
    placeholder: 'Search by name or email',
    isVisible: true,
    isEnabled: true,
    isLikelyClickable: true,
    structuredLocatorPriority: [
      {
        method: 'getByPlaceholder',
        text: 'Search by name or email',
        exact: false
      }
    ]
  } as DomElementSnapshot;
}

describe('deterministicLocatorResolver', () => {
  const payload = {
    'Full Name': 'adithya j',
    'Email Address': 'user@example.com'
  };

  it('matches PrimeNG table row for display name click', async () => {
    const parsedAction: ParsedAction = {
      rawStep: 'Click adithya j',
      actionType: 'click',
      target: 'adithya j',
      value: null,
      parseStatus: 'ok',
      parseReason: 'parsed_successfully',
      parseConfidence: 0.9
    };

    const candidates = await resolveDeterministicCandidates(
      {} as never,
      parsedAction,
      [rowElement('adithya j sanjeevkumar.m00@gmail.com QA TEST Active')],
      payload
    );

    assert.ok(candidates.length > 0);
    assert.ok(candidates.some((candidate) => /adithya j/i.test(candidate.locator)));
    assert.ok(!candidates[0].locator.includes('nth-of-type'));
  });

  it('limits Click Search to search input controls', async () => {
    const parsedAction: ParsedAction = {
      rawStep: 'Click Search',
      actionType: 'click',
      target: 'Search',
      value: null,
      parseStatus: 'ok',
      parseReason: 'parsed_successfully',
      parseConfidence: 0.9
    };

    const candidates = await resolveDeterministicCandidates(
      {} as never,
      parsedAction,
      [
        searchInputElement(),
        rowElement('Workflow Operators something search in row text')
      ],
      payload
    );

    assert.ok(candidates.length > 0);
    assert.equal(candidates[0].locatorType, 'getByPlaceholder');
  });
});
