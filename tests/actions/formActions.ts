import type { Locator, Page } from '@playwright/test';

/** Find the first visible + enabled match from a locator */
export async function firstUsable(locator: Locator): Promise<Locator | null> {
  try {
    await locator.first().waitFor({ state: 'attached', timeout: 5000 });
  } catch {}
  const count = await locator.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const c = locator.nth(i);
    const visible = await c.isVisible().catch(() => false);
    const enabled = await c.isEnabled().catch(() => false);
    if (visible && enabled) return c;
  }
  return null;
}

/** Fill using the first usable locator from the list */
export async function fillFirst(
  label: string,
  locators: Locator[],
  value: string
): Promise<void> {
  for (const locator of locators) {
    const c = await firstUsable(locator);
    if (c) { await c.fill(value); return; }
  }
  throw new Error(`fillFirst: no usable input found for "${label}"`);
}

/** Click using the first usable locator from the list */
export async function clickFirst(
  label: string,
  locators: Locator[]
): Promise<void> {
  for (const locator of locators) {
    const c = await firstUsable(locator);
    if (c) { await c.click(); return; }
  }
  throw new Error(`clickFirst: no usable element found for "${label}"`);
}

/** Resolve a configured locator (supports testid= prefix) */
export function configuredLocator(page: Page, selector: string | undefined): Locator {
  if (!selector?.trim()) return page.locator('__not_configured__');
  const s = selector.trim();
  return s.startsWith('testid=')
    ? page.getByTestId(s.replace(/^testid=/, ''))
    : page.locator(s);
}

/** Open a custom dropdown and click the matching option */
export async function selectCustomDropdown(
  page: Page,
  openFn: () => Locator,
  optionValue: string
): Promise<void> {
  await openFn().click();
  const escaped = optionValue.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
  const regex = new RegExp(`^${escaped}$`, 'i');
  const popup = page
    .locator('[role="listbox"],[role="menu"],[role="dialog"]')
    .filter({ hasText: regex });
  const candidates = [
    page.getByRole('option', { name: regex }),
    popup.getByRole('option', { name: regex }),
    popup.getByText(regex),
    page.locator('[aria-selected],li[role="option"]').filter({ hasText: regex })
  ];
  for (const loc of candidates) {
    const c = await firstUsable(loc);
    if (c) { await c.click(); return; }
  }
  throw new Error(`selectCustomDropdown: no option found for "${optionValue}"`);
}
