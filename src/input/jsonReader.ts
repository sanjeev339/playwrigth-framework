import fs from 'fs-extra';
import { z } from 'zod';
import dotenv from 'dotenv';
import type { TestDataRecord } from '../types';
import { resolveFromRoot } from '../utils/fileUtils';

dotenv.config();

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

export async function readTestData(filePath?: string): Promise<TestDataRecord[]> {
  const effectivePath = filePath ?? process.env.JSON_PATH;

  if (!effectivePath) {
    throw new Error('JSON path must be provided via --json argument or JSON_PATH environment variable');
  }

  if (!(await fs.pathExists(effectivePath))) {
    throw new Error(`JSON test data file not found at ${effectivePath}`);
  }

  console.log(`Reading JSON: ${effectivePath}`);
  const raw = await fs.readJson(effectivePath);
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
