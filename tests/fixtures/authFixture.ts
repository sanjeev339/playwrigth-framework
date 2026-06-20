import { test as base } from '@playwright/test';
import { LoginPage } from '../pages/base/LoginPage';

/**
 * Extends Playwright base test by injecting login into the `page` fixture.
 * This guarantees we log in fresh for each test and preserve sessionStorage,
 * bypassing issues with storageState and apps that do not auto-redirect.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const email = process.env.LOGIN_EMAIL || 'demo@eigen-dyne.com';
    const password = process.env.LOGIN_PASSWORD || 'Password@123';

    if (email && password) {
      await new LoginPage(page).login(email, password);
      
      // Wait for the URL to change away from the login page
      await page.waitForFunction(() => !window.location.href.includes('login'), undefined, { timeout: 15_000 }).catch(() => undefined);
    }

    await use(page);
  }
});

export { expect } from '@playwright/test';
