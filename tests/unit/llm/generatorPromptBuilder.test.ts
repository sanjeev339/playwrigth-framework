import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { buildDeterministicReconTest } from '../../../src/llm/generatorPromptBuilder';
import { validateGeneratedReconTest } from '../../../src/llm/validateGeneratedReconTest';
import type { ReconAction } from '../../../src/recon/reconActionExtractor';
import type { Scenario } from '../../../src/types';
import { resolveFromRoot } from '../../../src/utils/fileUtils';

const scenario: Scenario = {
  scenario_id: 'TC-UM-003',
  module: 'User Management',
  raw_steps: [],
  steps: [],
  expected_results: [],
  payload: {
    'First Name': 'adithya',
    'Last Name': 'j',
    'Full Name': 'adithya j',
    'Email Address': 'sanjeevkumar.m00@gmail.com',
    Role: 'Workflow Operators'
  },
  metadata: {
    execution_order: 1,
    data_strategy: 'positive_valid_update',
    edge_case_type: null,
    created_at: '2026-01-01T00:00:00.000Z',
    source_excel: 'input/test_flow.xlsx',
    source_json: 'input/test_data.json'
  }
};

function loadFixtureActions(): ReconAction[] {
  const fixturePath = resolveFromRoot('tests/fixtures/recon-actions/TC-UM-003.actions.json');
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as ReconAction[];
}

function loadReconSummaryActions(): ReconAction[] {
  const summaryPath = resolveFromRoot('recon-summary/TC-UM-003.actions.json');
  return JSON.parse(readFileSync(summaryPath, 'utf8')) as ReconAction[];
}

describe('buildDeterministicReconTest', () => {
  it('emits recon locators and avoids legacy hardcoded patterns', () => {
    const reconActions = loadFixtureActions();
    const code = buildDeterministicReconTest(scenario, reconActions);

    validateGeneratedReconTest(code, scenario, reconActions);

    assert.match(code, /page\.getByRole\("button", \{ name: \/User Management\/i \}\)/);
    assert.match(code, /toHaveURL\(\/internal-user\/i/);

    const banned = ["getByRole('complementary')", 'data-pc-section', '/^Edit$/i', 'user-management|edit|add user'];
    for (const fragment of banned) {
      assert.equal(code.includes(fragment), false, `unexpected hardcoded fragment: ${fragment}`);
    }
  });

  it('uses payload-stable row locators, stable URLs, and skips failed Role recon', () => {
    const reconActions = loadReconSummaryActions();
    const code = buildDeterministicReconTest(scenario, reconActions);

    validateGeneratedReconTest(code, scenario, reconActions);

    assert.match(
      code,
      /getByRole\('row'\)\.filter\(\{ hasText: "adithya j" \}\)\.filter\(\{ hasText: "sanjeevkumar\.m00@gmail\.com" \}\)/
    );
    assert.equal(code.includes('1041ab24-378b-4d57-8c04-0320ad208ffb'), false);
    assert.match(code, /toHaveURL\(\/user-detail\/i/);
    assert.match(code, /recon-skip/);
    assert.match(code, /Step 6: Select Role/);
    assert.equal(code.includes("getByRole('combobox', { name: /Role/i })"), false);
    assert.match(code, /getByRole\("button", \{ name: \/Save\/i \}\)/);
    assert.match(
      code,
      /Step 3: Click adithya j[\s\S]*?getByRole\('row'\)\.filter\(\{ hasText: "adithya j" \}\)/
    );
    assert.match(code, /Step 2: search the user by name or email[\s\S]*?getByPlaceholder\(\/Search by name or email\/i\)/);
    assert.equal(code.includes('getByRole("textbox", { name: /Search by name or email/i })'), false);
  });
});
