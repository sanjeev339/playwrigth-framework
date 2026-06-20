import type { Locator, Page } from '@playwright/test';
import { firstUsable } from './formActions';

/** Open the row action menu for a row identified by text, then click a menu item */
export async function clickRowAction(
  page: Page,
  rowIdentity: string,
  actionLabel: string
): Promise<void> {
  const escaped = rowIdentity.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
  const row = page.getByRole('row', { name: new RegExp(escaped, 'i') });
  const menuBtn = row.locator('button').nth(0);
  await menuBtn.click();
  const item = page
    .getByRole('menuitem', { name: new RegExp(actionLabel, 'i') })
    .or(page.getByRole('link', { name: new RegExp(actionLabel, 'i') }));
  const usable = await firstUsable(item);
  if (!usable)
    throw new Error(`clickRowAction: "${actionLabel}" not found in row "${rowIdentity}"`);
  await usable.click();
}

/** Click a row-action menu opener, then click the menu item (supports recon locators) */
export async function clickMenuItemAfterRowAction(
  label: string,
  openMenu: () => Locator,
  item: () => Locator
): Promise<void> {
  let candidate = await firstUsable(item());
  if (!candidate) {
    const opener = await firstUsable(openMenu());
    if (!opener)
      throw new Error(`clickMenuItemAfterRowAction: opener not found for "${label}"`);
    await opener.click();
    candidate = await firstUsable(item());
  }
  if (!candidate)
    throw new Error(`clickMenuItemAfterRowAction: item not found for "${label}"`);
  await candidate.click();
}

/** Type into a search field and wait for results */
export async function searchTable(page: Page, query: string): Promise<void> {
  const searchInput = page
    .getByPlaceholder(/search/i)
    .or(page.getByRole('searchbox'))
    .first();
  await searchInput.fill(query);
  await page.waitForTimeout(300);
}
