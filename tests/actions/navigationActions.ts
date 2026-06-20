import type { Page } from '@playwright/test';

/** Resolve login URL from environment variables */
export function getLoginUrl(): string {
  const url =
    process.env.LOGIN_URL ??
    process.env.WEBSITE_URL ??
    (process.env.APP_BASE_URL
      ? `${process.env.APP_BASE_URL.replace(/\/+$/, '')}/${
          (process.env.LOGIN_PATH ?? 'login').replace(/^\/+/, '')
        }`
      : undefined);
  if (!url) throw new Error('Missing LOGIN_URL, WEBSITE_URL, or APP_BASE_URL');
  return url;
}

/** Wait for DOM to be fully loaded */
export async function waitForPageReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
}

/** Wait for network to be idle — use after form submits */
export async function waitForNetworkIdle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => undefined);
}
