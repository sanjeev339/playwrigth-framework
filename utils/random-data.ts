/**
 * Pure random-data generators.
 * No Playwright Page dependency — safe to use anywhere in the framework.
 */

const FIRST_NAMES = ['Alex', 'Jordan', 'Morgan', 'Taylor', 'Casey', 'Riley', 'Drew', 'Avery'];
const LAST_NAMES  = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis'];

/** Returns a random element from an array. */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Generates a random full name, e.g. "Taylor Brown". */
export function randomFullName(): string {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

/**
 * Generates a unique email address using epoch ms.
 * @param prefix optional prefix segment, defaults to "user"
 */
export function randomEmail(prefix = 'user'): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}@testmail.dev`;
}

/** Generates a 10-digit mobile number starting with 9. */
export function randomMobile(): string {
  const tail = String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0');
  return `9${tail}`;
}
