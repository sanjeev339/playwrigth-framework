import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'vitest';
import fs from 'fs-extra';
import { diffReconSummaries, archiveReconRun, getArchivedRuns } from '../../../src/recon/reconVersioning';
import type { ReconAction } from '../../../src/recon/reconActionExtractor';
import { resolveFromRoot } from '../../../src/utils/fileUtils';

describe('reconVersioning & drift detection', () => {
  describe('diffReconSummaries', () => {
    it('detects no drift for identical actions', () => {
      const prev: ReconAction[] = [
        {
          scenarioId: 'TC-1',
          stepNo: 1,
          rawStep: 'Click login',
          actionType: 'click',
          target: 'login',
          value: null,
          selectedLocator: 'page.getByRole("button", { name: "Login" })',
          selectedValue: null,
          actionStatus: 'success',
          decisionSource: 'deterministic',
          snapshotFile: 'recon/TC-1/01-step-1.json',
          postActionUrl: 'https://example.com/dashboard',
          selectorConfidenceScore: 1.0
        }
      ];
      const curr = JSON.parse(JSON.stringify(prev));

      const result = diffReconSummaries(prev, curr);
      assert.equal(result.hasDrift, false);
      assert.equal(result.diffs.length, 0);
      assert.equal(result.confidenceTrend.prevAverage, 1.0);
      assert.equal(result.confidenceTrend.currAverage, 1.0);
      assert.equal(result.confidenceTrend.deteriorated, false);
    });

    it('detects locator drift, URL drift, and confidence deterioration', () => {
      const prev: ReconAction[] = [
        {
          scenarioId: 'TC-1',
          stepNo: 1,
          rawStep: 'Click login',
          actionType: 'click',
          target: 'login',
          value: null,
          selectedLocator: 'page.getByRole("button", { name: "Login" })',
          selectedValue: null,
          actionStatus: 'success',
          decisionSource: 'deterministic',
          snapshotFile: 'recon/TC-1/01-step-1.json',
          postActionUrl: 'https://example.com/dashboard',
          selectorConfidenceScore: 1.0
        }
      ];

      const curr: ReconAction[] = [
        {
          scenarioId: 'TC-1',
          stepNo: 1,
          rawStep: 'Click login',
          actionType: 'click',
          target: 'login',
          value: null,
          selectedLocator: 'page.locator("xpath=//button")',
          selectedValue: null,
          actionStatus: 'success',
          decisionSource: 'llm',
          snapshotFile: 'recon/TC-1/01-step-1.json',
          postActionUrl: 'https://example.com/home',
          selectorConfidenceScore: 0.6
        }
      ];

      const result = diffReconSummaries(prev, curr);
      assert.equal(result.hasDrift, true);
      assert.equal(result.diffs.length, 3); // locator, url, confidence

      const locatorDrift = result.diffs.find(d => d.type === 'locator_drift');
      assert.ok(locatorDrift);
      assert.equal(locatorDrift.prevValue, 'page.getByRole("button", { name: "Login" })');
      assert.equal(locatorDrift.currValue, 'page.locator("xpath=//button")');

      const urlDrift = result.diffs.find(d => d.type === 'url_drift');
      assert.ok(urlDrift);
      assert.equal(urlDrift.prevValue, 'https://example.com/dashboard');
      assert.equal(urlDrift.currValue, 'https://example.com/home');

      const confDrift = result.diffs.find(d => d.type === 'confidence_drift');
      assert.ok(confDrift);
      assert.equal(confDrift.prevValue, 1.0);
      assert.equal(confDrift.currValue, 0.6);

      assert.equal(result.confidenceTrend.prevAverage, 1.0);
      assert.equal(result.confidenceTrend.currAverage, 0.6);
      assert.equal(result.confidenceTrend.deteriorated, true);
    });

    it('detects step additions and removals', () => {
      const prev: ReconAction[] = [
        {
          scenarioId: 'TC-1',
          stepNo: 1,
          rawStep: 'Click login',
          actionType: 'click',
          target: 'login',
          value: null,
          selectedLocator: 'page.getByRole("button")',
          selectedValue: null,
          actionStatus: 'success',
          decisionSource: 'deterministic',
          snapshotFile: 'recon/TC-1/01-step-1.json',
          postActionUrl: 'https://example.com/dashboard',
          selectorConfidenceScore: 1.0
        }
      ];

      const curr: ReconAction[] = [
        {
          scenarioId: 'TC-1',
          stepNo: 1,
          rawStep: 'Click login',
          actionType: 'click',
          target: 'login',
          value: null,
          selectedLocator: 'page.getByRole("button")',
          selectedValue: null,
          actionStatus: 'success',
          decisionSource: 'deterministic',
          snapshotFile: 'recon/TC-1/01-step-1.json',
          postActionUrl: 'https://example.com/dashboard',
          selectorConfidenceScore: 1.0
        },
        {
          scenarioId: 'TC-1',
          stepNo: 2,
          rawStep: 'Enter username',
          actionType: 'fill',
          target: 'username',
          value: 'john',
          selectedLocator: 'page.locator("input")',
          selectedValue: null,
          actionStatus: 'success',
          decisionSource: 'deterministic',
          snapshotFile: 'recon/TC-1/02-step-2.json',
          postActionUrl: 'https://example.com/dashboard',
          selectorConfidenceScore: 0.9
        }
      ];

      const resultAdd = diffReconSummaries(prev, curr);
      assert.equal(resultAdd.hasDrift, true);
      assert.equal(resultAdd.diffs.length, 1);
      assert.equal(resultAdd.diffs[0].type, 'step_added');
      assert.equal(resultAdd.diffs[0].rawStep, 'Enter username');

      const resultRemove = diffReconSummaries(curr, prev);
      assert.equal(resultRemove.hasDrift, true);
      assert.equal(resultRemove.diffs.length, 1);
      assert.equal(resultRemove.diffs[0].type, 'step_removed');
      assert.equal(resultRemove.diffs[0].rawStep, 'Enter username');
    });
  });

  describe('archiving and rolling history', () => {
    it('archives recon files and respects rolling history limit', async () => {
      const scenarioId = 'TC-UNIT-TEST-VERSIONING';
      const safeId = 'tc-unit-test-versioning';
      const reconDir = resolveFromRoot('recon', safeId);
      const summaryFile = resolveFromRoot('recon-summary', `${safeId}.actions.json`);
      const historyDir = resolveFromRoot('recon-history', safeId);

      // Clean up previous runs
      await fs.remove(reconDir);
      await fs.remove(summaryFile);
      await fs.remove(historyDir);

      // Create dummy recon files
      await fs.ensureDir(reconDir);
      await fs.writeJson(path.join(reconDir, '01-snapshot.json'), { data: 'dummy' });

      await fs.ensureDir(path.dirname(summaryFile));
      await fs.writeJson(summaryFile, [{ stepNo: 1, rawStep: 'Dummy action' }]);

      // Archive a normal run
      process.env.DEPLOYMENT_BOUNDARY = 'false';
      const archivePath = await archiveReconRun(scenarioId);
      assert.ok(archivePath);
      assert.ok(await fs.pathExists(archivePath));
      assert.ok(await fs.pathExists(path.join(archivePath, 'snapshots', '01-snapshot.json')));
      assert.ok(await fs.pathExists(path.join(archivePath, 'actions.json')));

      // Test listing archived runs
      const runs = await getArchivedRuns(scenarioId);
      assert.equal(runs.length, 1);
      assert.equal(runs[0].type, 'run');

      // Archive 11 more runs to trigger rolling retention (limit is 10 non-deployment runs)
      for (let i = 0; i < 11; i++) {
        // Sleep small duration so timestamps differ
        await new Promise(resolve => setTimeout(resolve, 5));
        await archiveReconRun(scenarioId);
      }

      const postRollingRuns = await getArchivedRuns(scenarioId);
      // We should have exactly 10 run directories left because oldest ones are pruned
      const regularRuns = postRollingRuns.filter(r => r.type === 'run');
      assert.equal(regularRuns.length, 10);

      // Now archive a deployment boundary run
      process.env.DEPLOYMENT_BOUNDARY = 'true';
      await new Promise(resolve => setTimeout(resolve, 5));
      const deploymentPath = await archiveReconRun(scenarioId);
      assert.ok(deploymentPath);

      const finalRuns = await getArchivedRuns(scenarioId);
      const deploymentRuns = finalRuns.filter(r => r.type === 'deployment');
      assert.equal(deploymentRuns.length, 1);

      // Deployment runs should not be pruned, even if we run rolling pruning again
      process.env.DEPLOYMENT_BOUNDARY = 'false';
      for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
        await archiveReconRun(scenarioId);
      }

      const runsAfterMorePruning = await getArchivedRuns(scenarioId);
      assert.equal(runsAfterMorePruning.filter(r => r.type === 'run').length, 10);
      assert.equal(runsAfterMorePruning.filter(r => r.type === 'deployment').length, 1);

      // Clean up
      await fs.remove(reconDir);
      await fs.remove(summaryFile);
      await fs.remove(historyDir);
    });
  });
});
