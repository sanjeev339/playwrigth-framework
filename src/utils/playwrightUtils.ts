import type { Locator, Page } from '@playwright/test';

/**
 * Performs login using configured locator selectors or standard heuristics.
 */
export async function performLogin(
  page: Page,
  email: string,
  password: string,
  waitFn?: (page: Page) => Promise<any>
): Promise<void> {
  await fillFirst(page, email, [
    () => configuredLocator(page, process.env.LOGIN_EMAIL_SELECTOR),
    () => page.getByLabel(/email|username|user name/i),
    () => page.getByPlaceholder(/email|username|user name/i),
    () => page.locator('input[type="email"]').first(),
    () => page.locator('input[name*="email" i], input[name*="user" i]').first()
  ]);

  await fillFirst(page, password, [
    () => configuredLocator(page, process.env.LOGIN_PASSWORD_SELECTOR),
    () => page.getByLabel(/password/i),
    () => page.getByPlaceholder(/password/i),
    () => page.locator('input[type="password"]').first(),
    () => page.locator('input[name*="password" i]').first()
  ]);

  const loginUrl = page.url();
  await clickFirst(page, [
    () => configuredLocator(page, process.env.LOGIN_SUBMIT_SELECTOR),
    () => page.getByRole('button', { name: /login|sign in|submit/i }),
    () => page.locator('button[type="submit"]').first()
  ]);

  // Wait for the URL to change away from the login page, indicating successful login redirection
  await page.waitForFunction((url) => window.location.href !== url, loginUrl, { timeout: 10_000 }).catch(() => undefined);

  if (waitFn) {
    await waitFn(page);
  }
}

/**
 * Returns a Playwright locator based on a selector string.
 * Supports testid= prefixes.
 */
export function configuredLocator(page: Page, selector: string | undefined): Locator {
  if (!selector?.trim()) {
    return page.locator('__configured_locator_not_set__');
  }

  const trimmed = selector.trim();
  if (trimmed.startsWith('testid=')) {
    return page.getByTestId(trimmed.replace(/^testid=/, ''));
  }

  return page.locator(trimmed);
}

/**
 * Fills the first usable locator from a list of locator factories.
 */
export async function fillFirst(page: Page, value: string, locatorFactories: Array<() => Locator>): Promise<void> {
  for (const createLocator of locatorFactories) {
    const locator = createLocator();
    if (await isUsable(locator)) {
      await locator.fill(value);
      return;
    }
  }

  throw new Error('No usable input locator found.');
}

/**
 * Clicks the first usable locator from a list of locator factories.
 */
export async function clickFirst(page: Page, locatorFactories: Array<() => Locator>): Promise<void> {
  for (const createLocator of locatorFactories) {
    const locator = createLocator();
    if (await isUsable(locator)) {
      await locator.click();
      return;
    }
  }

  throw new Error('No usable click locator found.');
}

/**
 * Checks whether a locator is usable (exists, is visible, is enabled) within a short timeout.
 */
export async function isUsable(locator: Locator): Promise<boolean> {
  try {
    const first = locator.first();
    return (
      (await first.count()) > 0 &&
      (await first.isVisible({ timeout: 750 })) &&
      (await first.isEnabled({ timeout: 750 }))
    );
  } catch {
    return false;
  }
}

/**
 * Executes an action safely, returning the error message if it throws, otherwise null.
 */
export async function safeAction(action: () => Promise<void>): Promise<string | null> {
  try {
    await action();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Navigates to a URL with retry logic.
 */
export async function gotoWithRetry(page: Page, url: string, attempts = 3): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      return;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        break;
      }
      await page.waitForTimeout(1000 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
