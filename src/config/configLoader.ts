import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

const DEFAULT_TEST_ID_ATTRIBUTES = [
  'data-testid', 'data-test', 'data-cy', 'data-qa',
  'data-automation-id', 'data-automation', 'data-test-id',
  'data-id', 'qa-id', 'data-component', 'data-e2e'
];

const frameworkConfigSchema = z.object({
  locator: z.object({
    testIdAttributes: z
      .array(z.string())
      .min(1)
      .default(DEFAULT_TEST_ID_ATTRIBUTES),
    autoDetectDataAttributes: z.boolean().default(false),
  }).default({}),
  execution: z.object({
    generationConcurrency: z.number().int().min(1).max(20).default(5),
  }).default({}),
});

export type FrameworkConfig = z.infer<typeof frameworkConfigSchema>;

let cached: FrameworkConfig | null = null;

export function getFrameworkConfig(): FrameworkConfig {
  if (cached) return cached;

  const configPath = path.join(process.cwd(), 'config.yaml');
  let parsed: unknown = {};

  if (existsSync(configPath)) {
    try {
      const fileContents = readFileSync(configPath, 'utf8');
      parsed = parseYaml(fileContents);
    } catch (err) {
      logger.warn(`Failed to parse config.yaml, using defaults. Error: ${(err as Error).message}`);
    }
  }

  const result = frameworkConfigSchema.safeParse(parsed);
  if (!result.success) {
    logger.warn(`Invalid configuration in config.yaml, falling back to defaults. Validation errors: ${result.error.message}`);
    cached = frameworkConfigSchema.parse({});
  } else {
    cached = result.data;
  }

  return cached;
}
