import path from 'node:path';
import fs from 'fs-extra';
import { readExcelRows } from '../input/excelReader';
import { readTestData } from '../input/jsonReader';
import type { Scenario, TestDataRecord, TestFlowRow } from '../types';
import { resolveFromRoot, toSafeFileName, writeJsonFile } from '../utils/fileUtils';
import { logger } from '../utils/logger';
import { normalizeScenarioSteps } from './stepNormalizer';

const passwordLikeKey = /(password|passcode|secret|token|jwt|cookie|authorization)/i;

export async function buildScenarios(options: {
  excelPath?: string;
  jsonPath?: string;
  outputDir?: string;
} = {}): Promise<Scenario[]> {
  const excelPath = options.excelPath ?? resolveFromRoot('input', 'test_flow.xlsx');
  const jsonPath = options.jsonPath ?? resolveFromRoot('input', 'test_data.json');
  const outputDir = options.outputDir ?? resolveFromRoot('scenarios');

  const [rows, testData] = await Promise.all([readExcelRows(excelPath), readTestData(jsonPath)]);
  const payloadByScenarioId = new Map(testData.map((record) => [record.scenario_id, record]));
  const groupedRows = groupRowsByScenario(rows);

  await fs.ensureDir(outputDir);

  const scenarios: Scenario[] = [];
  const processedScenarioIds = new Set<string>();

  for (const [scenarioId, scenarioRows] of groupedRows) {
    const dataRecord = payloadByScenarioId.get(scenarioId);
    processedScenarioIds.add(scenarioId);
    if (!dataRecord) {
      logger.warn(`No payload found for scenario ${scenarioId} in JSON; writing scenario with empty payload.`);
    }

    const scenario = createScenario(scenarioId, scenarioRows, dataRecord, excelPath, jsonPath);
    const filePath = path.join(outputDir, `${toSafeFileName(scenarioId)}.json`);
    await writeJsonFile(filePath, scenario);
    scenarios.push(scenario);
    logger.info(`Wrote scenario ${scenarioId} -> ${filePath}`);
  }

  for (const scenarioId of payloadByScenarioId.keys()) {
    if (!processedScenarioIds.has(scenarioId)) {
      logger.warn(`Scenario ${scenarioId} found in JSON but missing in Excel; skipping.`);
    }
  }

  return scenarios;
}

function groupRowsByScenario(rows: TestFlowRow[]): Map<string, TestFlowRow[]> {
  const groupedRows = new Map<string, TestFlowRow[]>();

  for (const row of rows) {
    const existing = groupedRows.get(row.scenario_id) ?? [];
    existing.push(row);
    groupedRows.set(row.scenario_id, existing);
  }

  return groupedRows;
}

function createScenario(
  scenarioId: string,
  rows: TestFlowRow[],
  dataRecord: TestDataRecord | undefined,
  excelPath: string,
  jsonPath: string
): Scenario {
  const orderedRows = [...rows].sort((left, right) => (left.step_no ?? 0) - (right.step_no ?? 0));
  const firstRow = orderedRows[0];
  const payload = sanitizePayload(dataRecord?.payload ?? {});
  const rawSteps = orderedRows.map((row, index) => ({
    step_no: row.step_no ?? index + 1,
    instruction: row.instruction,
    expected_result: row.expected_result
  }));
  const steps = normalizeScenarioSteps(rawSteps, payload);

  return {
    scenario_id: scenarioId,
    module: firstRow?.module,
    action: firstRow?.action,
    raw_steps: rawSteps,
    steps,
    expected_results: orderedRows.map((row) => row.expected_result).filter((value): value is string => Boolean(value)),
    payload,
    metadata: {
      execution_order: dataRecord?.execution_order,
      data_strategy: dataRecord?.data_strategy,
      edge_case_type: dataRecord?.edge_case_type,
      depends_on: dataRecord?.depends_on,
      created_at: new Date().toISOString(),
      source_excel: path.relative(process.cwd(), excelPath),
      source_json: path.relative(process.cwd(), jsonPath)
    }
  };
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (passwordLikeKey.test(key)) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}

if (require.main === module) {
  buildScenarios()
    .then((scenarios) => {
      logger.info(`Built ${scenarios.length} scenario file(s).`);
    })
    .catch((error) => {
      logger.error('Scenario build failed.', error);
      process.exitCode = 1;
    });
}
