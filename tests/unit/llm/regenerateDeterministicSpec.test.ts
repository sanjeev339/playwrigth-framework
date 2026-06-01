import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';
import { regenerateDeterministicSpec } from '../../../src/llm/regenerateDeterministicSpec';
import type { ReconAction } from '../../../src/recon/reconActionExtractor';
import type { Scenario } from '../../../src/types';

describe('regenerateDeterministicSpec', () => {
  it('writes a validated spec for a single scenario id', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'regen-spec-'));
    const scenarioDir = path.join(root, 'scenarios');
    const outputDir = path.join(root, 'generated');
    const reconSummaryDir = path.join(root, 'recon-summary');
    await import('node:fs/promises').then((fs) =>
      Promise.all([fs.mkdir(scenarioDir, { recursive: true }), fs.mkdir(outputDir, { recursive: true }), fs.mkdir(reconSummaryDir, { recursive: true })])
    );

    const scenario: Scenario = {
      scenario_id: 'TC-UM-003',
      module: 'User Management',
      raw_steps: [],
      steps: [],
      expected_results: [],
      payload: { 'Full Name': 'adithya j', Role: 'Workflow Operators' },
      metadata: {
        execution_order: 1,
        data_strategy: 'positive_valid_update',
        edge_case_type: null,
        created_at: '2026-01-01T00:00:00.000Z',
        source_excel: 'input/test_flow.xlsx',
        source_json: 'input/test_data.json'
      }
    };

    const reconActions: ReconAction[] = [
      {
        scenarioId: 'TC-UM-003',
        stepNo: 1,
        rawStep: 'Navigate to User Management',
        actionType: 'click',
        target: 'User Management',
        value: null,
        selectedLocator: 'page.getByRole("button", { name: /User Management/i })',
        selectedValue: null,
        actionStatus: 'success',
        decisionSource: 'deterministic',
        snapshotFile: 'recon/TC-UM-003/04-step-1-after.json',
        postActionUrl: 'https://app.example.com/users/internal-user'
      }
    ];

    await writeFile(path.join(scenarioDir, 'TC-UM-003.json'), JSON.stringify(scenario, null, 2));
    await writeFile(path.join(reconSummaryDir, 'TC-UM-003.actions.json'), JSON.stringify(reconActions, null, 2));

    const originalCwd = process.cwd();
    process.chdir(root);

    try {
      const written = await regenerateDeterministicSpec({ scenarioIds: ['TC-UM-003'], scenarioDir, outputDir });
      assert.equal(written.length, 1);
      const code = await readFile(written[0], 'utf8');
      assert.match(code, /User Management/i);
      assert.match(code, /internal-user/i);
    } finally {
      process.chdir(originalCwd);
      await rm(root, { recursive: true, force: true });
    }
  });
});
