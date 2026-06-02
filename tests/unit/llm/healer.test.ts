import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import { healFailedTests } from '../../../src/llm/healer';
import { callLLM } from '../../../src/llm/llmClient';

vi.mock('../../../src/llm/llmClient', () => {
  return {
    callLLM: vi.fn().mockResolvedValue('// healed test code')
  };
});

describe('healer', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(__dirname, `../../temp-healer-test-${Date.now()}`);
    fs.ensureDirSync(tempDir);
  });

  afterEach(() => {
    fs.removeSync(tempDir);
    vi.clearAllMocks();
  });

  it('runs healing and includes fallback locators in healer prompt', async () => {
    const runResultPath = path.join(tempDir, 'run-result.json');
    const scenarioDir = path.join(tempDir, 'scenarios');
    const generatedDir = path.join(tempDir, 'tests/generated');
    const reconDir = path.join(tempDir, 'recon');
    const outputDir = path.join(tempDir, 'healed');
    const healingReportPath = path.join(tempDir, 'healing-result.json');

    fs.ensureDirSync(scenarioDir);
    fs.ensureDirSync(generatedDir);
    fs.ensureDirSync(reconDir);
    fs.ensureDirSync(outputDir);
    fs.ensureDirSync(path.join(tempDir, 'recon-summary'));

    // Write a mock run result with failure
    await fs.writeJson(runResultPath, {
      status: 'failed',
      failedTestFiles: [],
      stdout: 'some error',
      stderr: 'Element not found'
    });

    // Write mock scenario
    await fs.writeJson(path.join(scenarioDir, 'TC-UM-003.json'), {
      scenario_id: 'TC-UM-003',
      steps: []
    });

    // Write mock actions.json in recon-summary
    const actionsPath = path.join(tempDir, 'recon-summary', 'TC-UM-003.actions.json');
    await fs.writeJson(actionsPath, [
      {
        stepNo: 1,
        rawStep: 'Click user details',
        selectedLocator: 'page.getByText("John")',
        fallbackLocators: ['page.getByRole("button", { name: "John" })'],
        selectorConfidenceScore: 0.9,
        selectorRisk: 'low',
        ambiguityCount: 0
      }
    ]);

    // Write mock generated spec
    await fs.writeFile(path.join(generatedDir, 'TC-UM-003.spec.ts'), '// original code');

    const result = await healFailedTests({
      runResultPath,
      scenarioDir,
      generatedDir,
      reconDir,
      reconSummaryDir: path.join(tempDir, 'recon-summary'),
      outputDir,
      healingReportPath
    });

    assert.equal(result.status, 'healed');
    assert.equal(result.healedFiles.length, 1);

    // Check if callLLM was called with prompt containing our fallback locator
    const callLLMMock = callLLM as any;
    assert.ok(callLLMMock.mock.calls.length > 0);
    const prompt = callLLMMock.mock.calls[0][0];
    assert.ok(prompt.includes('Fallback Locators from Recon'));
    assert.ok(prompt.includes('page.getByRole(\\"button\\", { name: \\"John\\" })'));
  });
});
