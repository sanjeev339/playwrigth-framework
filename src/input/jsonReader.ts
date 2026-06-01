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
  if (!(await fs.pathExists(filePath))) {
    throw new Error(`JSON test data file not found at ${filePath}`);
  }

  console.log(`Reading JSON: ${filePath}`);
  const raw = await fs.readJson(filePath);
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
