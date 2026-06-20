import { test, expect } from './authFixture';

/**
 * Re-export the test fixture from authFixture.
 * The authFixture now automatically sets the `storageState` for all tests,
 * allowing Playwright's built-in `page` and `context` to handle lifecycle safely.
 *
 * Usage in specs:
 *   import { test, expect } from '../fixtures';
 *   test('my test', async ({ page }) => { ... });
 */
export { test, expect };
