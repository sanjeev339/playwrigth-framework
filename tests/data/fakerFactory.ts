import { faker } from '@faker-js/faker';
import { detectFieldFaker } from './fieldDetector';
import { getSeedForScenario } from './fakerSeeds';

/**
 * Builds a dynamic payload on every test run.
 *
 * Rules:
 * - Negative/invalid strategy → ALL fields kept as-is (intentional bad data)
 * - Fields with a Faker mapping → generated fresh each run
 * - Fields with no mapping (Role, Status, IDs) → kept as-is from seed
 * - Secret fields (password, token) → NEVER replaced
 * - Internal keys starting with '_' → always skipped
 */
export function buildPayload(
  scenarioId: string,
  seed: Record<string, unknown>,
  options?: { dataStrategy?: string }
): Record<string, string> {
  const isNegative = /negative|invalid/i.test(options?.dataStrategy ?? '');

  if (isNegative) {
    // Keep intentionally invalid data exactly as the QA server generated it
    return Object.fromEntries(
      Object.entries(seed)
        .filter(([key]) => !key.startsWith('_'))
        .map(([key, val]) => [key, String(val ?? '')])
    );
  }

  faker.seed(getSeedForScenario(scenarioId));

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(seed)) {
    if (key.startsWith('_')) continue;
    const fakerFn = detectFieldFaker(key, String(value ?? ''));
    result[key] = fakerFn ? fakerFn() : String(value ?? '');
  }
  return result;
}
