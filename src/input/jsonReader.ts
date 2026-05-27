import fs from 'fs-extra';
import { z } from 'zod';
import type { TestDataRecord } from '../types';
import { resolveFromRoot } from '../utils/fileUtils';

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

export async function readTestData(filePath = resolveFromRoot('input', 'test_data.json')): Promise<TestDataRecord[]> {
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
  return parsed.data as TestDataRecord[];
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
