import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import { resolveFromRoot } from '../../../src/utils/fileUtils';
import { appendRunHistory, getScenarioRunHistory } from '../../../src/reports/runHistory';
import { classifyFailure } from '../../../src/reports/failureClassifier';

describe('flaky classification & run history', () => {
  const historyFile = resolveFromRoot('run-history.json');

  beforeEach(async () => {
    await fs.remove(historyFile);
  });

  it('saves and retrieves run history entries', async () => {
    await appendRunHistory({
      timestamp: new Date().toISOString(),
      scenarioId: 'TC-TEST-HIST-01',
      status: 'passed',
      durationMs: 1200
    });

    await appendRunHistory({
      timestamp: new Date().toISOString(),
      scenarioId: 'TC-TEST-HIST-01',
      status: 'failed',
      error: 'timeout waiting for selector',
      durationMs: 5000
    });

    await appendRunHistory({
      timestamp: new Date().toISOString(),
      scenarioId: 'TC-TEST-HIST-02',
      status: 'passed',
      durationMs: 800
    });

    const hist1 = await getScenarioRunHistory('TC-TEST-HIST-01');
    assert.equal(hist1.length, 2);
    assert.equal(hist1[0].status, 'passed');
    assert.equal(hist1[1].status, 'failed');
    assert.equal(hist1[1].error, 'timeout waiting for selector');

    const hist2 = await getScenarioRunHistory('TC-TEST-HIST-02');
    assert.equal(hist2.length, 1);
    assert.equal(hist2[0].status, 'passed');
  });

  it('classifies infrastructure flakiness correctly', async () => {
    // Scenario passes first
    await appendRunHistory({
      timestamp: new Date().toISOString(),
      scenarioId: 'TC-FLAKY-01',
      status: 'passed'
    });

    // Then fails with timeout
    const classification = await classifyFailure('TC-FLAKY-01', 'Error: page.goto: Timeout 30000ms exceeded.');
    assert.equal(classification.category, 'infrastructure_flakiness');
    assert.equal(classification.isFlaky, true); // true because it previously passed
  });

  it('classifies functional regression correctly', async () => {
    // Scenario passes first
    await appendRunHistory({
      timestamp: new Date().toISOString(),
      scenarioId: 'TC-REGRESS-01',
      status: 'passed'
    });

    // Then fails with expect assertion
    const classification = await classifyFailure('TC-REGRESS-01', 'Error: expect(received).toBe(expected)');
    assert.equal(classification.category, 'functional_regression');
    assert.equal(classification.isFlaky, false); // false for functional regressions
  });
});
