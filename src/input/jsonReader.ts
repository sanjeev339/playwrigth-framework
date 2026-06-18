import fs from 'fs-extra';
import { z } from 'zod';
import { getFrameworkPaths } from '../config/env';
import type { TestDataRecord } from '../types';

const testDataSchema = z.array(
  z.object({
    scenario_id: z.string().min(1, 'scenario_id is required'),
    execution_order: z.number().optional(),
    data_strategy: z.string().optional(),
    edge_case_type: z.string().nullable().optional(),
    depends_on: z.array(z.string()).optional(),
    payload: z.record(z.string(), z.unknown()).optional().default({})
  }).passthrough()
);

export async function readTestData(filePath = getFrameworkPaths().inputDataPath): Promise<TestDataRecord[]> {
  if (!filePath.toLowerCase().endsWith('.json')) {
    console.warn(`Warning: Expected a JSON file for test data, but got ${filePath}. Proceeding without test data payloads.`);
    return [];
  }

  if (!(await fs.pathExists(filePath))) {
    console.warn(`Warning: JSON test data file not found at ${filePath}. Proceeding without test data payloads.`);
    return [];
  }

  console.log(`Reading JSON: ${filePath}`);
  let raw = await fs.readJson(filePath);

  if (Array.isArray(raw)) {
    raw = raw.map((item: any) => {
      if (item && typeof item === 'object') {
        const normalized: any = { ...item };
        if (!normalized.scenario_id && normalized.id) {
          normalized.scenario_id = String(normalized.id);
        }
        if (!normalized.payload && normalized.test_data) {
          normalized.payload = normalized.test_data;
        }
        if (normalized.payload && typeof normalized.payload === 'object') {
          if (normalized.payload._data_strategy && !normalized.data_strategy) {
            normalized.data_strategy = String(normalized.payload._data_strategy);
          }
          if (normalized.payload._edge_case_type !== undefined && normalized.edge_case_type === undefined) {
            normalized.edge_case_type = normalized.payload._edge_case_type;
          }
          if (normalized.payload._execution_order !== undefined && normalized.execution_order === undefined) {
            const val = Number(normalized.payload._execution_order);
            if (!isNaN(val)) normalized.execution_order = val;
          }
        }
        return normalized;
      }
      return item;
    });
  }

  const parsed = testDataSchema.safeParse(raw);

  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid JSON test data: ${details}`);
  }

  console.log(`Parsed data records: ${parsed.data.length}`);
  return resolveEnvPlaceholders(parsed.data) as TestDataRecord[];
}

function resolveEnvPlaceholders(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(resolveEnvPlaceholders);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [key, resolveEnvPlaceholders(nestedValue)])
    );
  }

  if (typeof value !== 'string') {
    return value;
  }

  const envName = value.match(/^\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}$/)?.[1] ?? value.match(/^\$\{\s*([A-Z][A-Z0-9_]*)\s*\}$/)?.[1];
  if (!envName) {
    return value;
  }

  return process.env[envName] ?? value;
}

if (require.main === module) {
  readTestData()
    .then((records) => {
      console.log(JSON.stringify(records, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
