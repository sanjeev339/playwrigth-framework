/**
 * Controls Faker seed behaviour via FAKER_SEED environment variable:
 *   (not set) or "random" → different every run — maximum test coverage
 *   "fixed"               → deterministic per scenario_id — stable for CI
 *   "<number>"            → exact seed — use to reproduce a specific failure
 */
export function getSeedForScenario(scenarioId: string): number {
  const env = process.env.FAKER_SEED;
  const base = hashString(scenarioId);

  if (!env || env === 'random') return (Date.now() + base) >>> 0;
  if (env === 'fixed')          return base;
  return (parseInt(env, 10) + base) >>> 0;
}

function hashString(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}
