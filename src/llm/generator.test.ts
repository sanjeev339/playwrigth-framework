import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { getLatestGenerationSelection } from '../generation/generationSelection';
import { validateGeneratedLocators } from '../recon/locatorValidator';
import type { ReconAction } from '../recon/reconActionExtractor';
import { writeFinalReport } from '../reports/reportWriter';
import type { Scenario } from '../types';
import { generateTests } from './generator';

async function main(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playwright-independent-generation-'));
  const scenarioDir = path.join(root, 'scenarios');
  const dynamicReconDir = path.join(root, 'dynamic-recon');
  const generatedDir = path.join(root, 'tests', 'generated');
  const healedDir = path.join(root, 'tests', 'healed');
  const quarantineDir = path.join(root, 'generated-quarantine');
  const reportDir = path.join(root, 'reports');
  const generationReportPath = path.join(reportDir, 'generation-result.json');

  try {
    await Promise.all([
      writeScenario(scenarioDir, 'TC-001', 'Dashboard'),
      writeScenario(scenarioDir, 'TC-002', 'Role'),
      writeScenario(scenarioDir, 'TC-003', 'Settings')
    ]);

    const staleFile = path.join(generatedDir, 'TC-002.spec.ts');
    await fs.outputFile(staleFile, 'stale generated test');

    const report = await generateTests({
      scenarioDir,
      dynamicReconDir,
      outputDir: generatedDir,
      quarantineDir,
      reportPath: generationReportPath,
      dependencies: {
        callLLM: async () => {
          throw new Error('Force deterministic generation in test.');
        },
        extractReconActions: async (scenarioId, reconRootDir) => {
          if (reconRootDir === dynamicReconDir) {
            return scenarioId === 'TC-002' ? [failedSelectAction(scenarioId)] : [successfulClickAction(scenarioId)];
          }
          return [];
        },
        now: () => new Date('2026-06-04T10:00:00.000Z')
      }
    });

    assert.deepEqual(report.summary, { total: 3, generated: 2, failed: 1 });
    assert.deepEqual(
      report.scenarios.map((scenario) => [scenario.scenario_id, scenario.status]),
      [
        ['TC-001', 'generated'],
        ['TC-002', 'failed'],
        ['TC-003', 'generated']
      ]
    );
    assert.equal(report.scenarios[1].failed_stage, 'deterministic-generation');
    assert.match(report.scenarios[1].error ?? '', /Missing recon locator for select step: Select Role/);
    assert.deepEqual(report.scenarios.map((scenario) => scenario.recon_source), ['dynamic', 'dynamic', 'dynamic']);
    assert.equal(await fs.pathExists(staleFile), false);
    assert.equal((await fs.readdir(path.join(quarantineDir, 'TC-002'))).length, 1);
    assert.equal(await fs.pathExists(path.join(generatedDir, 'TC-001.spec.ts')), true);
    assert.equal(await fs.pathExists(path.join(generatedDir, 'TC-003.spec.ts')), true);

    await fs.outputFile(path.join(generatedDir, 'STALE.spec.ts'), 'should not be selected');
    const selection = await getLatestGenerationSelection({ generationReportPath, generatedDir });
    assert.deepEqual(selection.successfulScenarioIds, ['TC-001', 'TC-003']);
    assert.deepEqual(
      selection.generatedFiles.map((file) => path.basename(file)),
      ['TC-001.spec.ts', 'TC-003.spec.ts']
    );

    const validationPath = path.join(reportDir, 'locator-validation.json');
    const validation = await validateGeneratedLocators({
      generatedDir,
      healedDir,
      generationReportPath,
      outputPath: validationPath
    });
    assert.deepEqual(
      validation.files.map((file) => path.basename(file.file)),
      ['TC-001.spec.ts', 'TC-003.spec.ts']
    );

    const runResultPath = path.join(reportDir, 'run-result.json');
    await fs.outputJson(runResultPath, {
      command: 'test command',
      status: 'passed',
      exitCode: 0,
      startedAt: '2026-06-04T10:00:00.000Z',
      endedAt: '2026-06-04T10:00:01.000Z',
      durationMs: 1000,
      stdout: '2 passed',
      stderr: '',
      failedTestFiles: []
    });

    const finalReport = await writeFinalReport({
      scenarioDir,
      generatedDir,
      healedDir,
      dynamicReconDir,
      generationReportPath,
      runResultPath,
      validationPath,
      outputJsonPath: path.join(reportDir, 'result.json'),
      outputHtmlPath: path.join(reportDir, 'result.html')
    });
    assert.deepEqual(finalReport.summary, { total: 3, passed: 2, failed: 0, blocked: 1, unknown: 0 });
    assert.equal(finalReport.scenarios.find((scenario) => scenario.scenario_id === 'TC-002')?.status, 'blocked');

    console.log('generator.test.ts passed');
  } finally {
    await fs.remove(root);
  }
}

async function writeScenario(dir: string, scenarioId: string, target: string): Promise<void> {
  const scenario: Scenario = {
    scenario_id: scenarioId,
    module: 'Independent generation',
    action: target,
    steps: [{ step_no: 1, instruction: `Click ${target}` }],
    expected_results: [],
    payload: target === 'Role' ? { Role: 'Admin' } : {},
    metadata: {
      created_at: '2026-06-04T10:00:00.000Z',
      source_excel: 'test',
      source_json: 'test'
    }
  };
  await fs.outputJson(path.join(dir, `${scenarioId}.json`), scenario);
}



function successfulClickAction(scenarioId: string): ReconAction {
  const target = scenarioId === 'TC-001' ? 'Dashboard' : 'Settings';
  return {
    scenarioId,
    stepNo: 1,
    rawStep: `Click ${target}`,
    actionType: 'click',
    target,
    value: null,
    selectedLocator: `page.getByRole("button", { name: /${target}/i })`,
    selectedValue: null,
    actionStatus: 'success',
    decisionSource: 'deterministic',
    snapshotFile: ''
  };
}

function failedSelectAction(scenarioId: string): ReconAction {
  return {
    scenarioId,
    stepNo: 1,
    rawStep: 'Select Role',
    actionType: 'select',
    target: 'Role',
    value: 'Admin',
    selectedLocator: null,
    selectedValue: null,
    actionStatus: 'failed',
    actionError: 'No safe validated locator candidates are available.',
    decisionSource: 'llm',
    snapshotFile: ''
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
