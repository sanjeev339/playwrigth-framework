import { faker } from '@faker-js/faker';
import { detectFieldFaker } from './fieldDetector';
import { getSeedForScenario } from './fakerSeeds';
import { getSharedState, setSharedState } from './sharedStateManager';

/**
 * Builds a dynamic payload on every test run.
 *
 * Rules:
 * - Negative/invalid strategy → ALL fields kept as-is (intentional bad data)
 * - Fields matching `[FAKER:key]` → Generate random word and save to Shared State under `key`
 * - Fields matching `[SHARED:key]` → Fetch value from Shared State under `key`
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
    // Keep intentionally invalid data exactly as the QA server generated it, but STILL resolve [SHARED:] tags!
    return Object.fromEntries(
      Object.entries(seed)
        .filter(([key]) => !key.startsWith('_'))
        .map(([key, val]) => {
          let value = String(val ?? '');
          const sharedMatch = value.match(/^\[SHARED:([^|\]]+)(?:\|([^\]]+))?\]$/i);
          if (sharedMatch) {
            const stateKey = sharedMatch[1].trim();
            const fallback = sharedMatch[2]?.trim();
            const stateValue = getSharedState()[stateKey];
            value = stateValue || fallback || value;
          }
          return [key, value];
        })
    );
  }

  faker.seed(getSeedForScenario(scenarioId));

  const result: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(seed)) {
    if (key.startsWith('_')) continue;
    
    const value = String(rawValue ?? '');
    
    // Explicit Faker override
    const fakerMatch = value.match(/^\[FAKER:([^\]]+)\]$/i);
    if (fakerMatch) {
      const stateKey = fakerMatch[1];
      const generated = faker.word.noun() + '-' + faker.string.numeric(4);
      setSharedState(stateKey, generated);
      result[key] = generated;
      continue;
    }

    // Explicit Shared State fetch with optional fallback: [SHARED:key] or [SHARED:key|fallbackValue]
    const sharedMatch = value.match(/^\[SHARED:([^|\]]+)(?:\|([^\]]+))?\]$/i);
    if (sharedMatch) {
      const stateKey = sharedMatch[1].trim();
      const fallback = sharedMatch[2]?.trim();
      const stateValue = getSharedState()[stateKey];
      
      if (!stateValue) {
        if (fallback) {
          console.warn(`[WARNING] Shared state key "${stateKey}" not found. Using fallback: "${fallback}".`);
          result[key] = fallback;
        } else {
          console.warn(`[WARNING] Shared state key "${stateKey}" not found and no fallback provided. Falling back to literal tag.`);
          result[key] = value;
        }
      } else {
        result[key] = stateValue;
      }
      continue;
    }

    // Default heuristic fallback
    const fakerFn = detectFieldFaker(key, value);
    result[key] = fakerFn ? fakerFn() : value;
  }
  return result;
}
