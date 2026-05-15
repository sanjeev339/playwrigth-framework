import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../../core/base/BasePage';

export class DevDashboardPage extends BasePage {
  readonly dashboardHeaderLocator: Locator;

  constructor(page: Page) {
    super(page);
    this.dashboardHeaderLocator = page.getByRole("heading", { name: "Dashboard" });
  }

  async goto(url: string): Promise<void> {
    await this.navigateTo(url);
  }

  async expectPageUrl(url: string | RegExp): Promise<void> {
    await expect(this.page).toHaveURL(url);
  }

  async expectDashboardHeaderVisible(): Promise<void> {
    await expect(this.dashboardHeaderLocator).toBeVisible();
  }
}
