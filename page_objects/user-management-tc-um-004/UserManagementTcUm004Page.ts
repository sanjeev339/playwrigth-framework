import { BasePage } from '../../core/base/BasePage';
import { Page, Locator, expect } from '@playwright/test';

export class UserManagementTcUm004Page extends BasePage {
  private userDropdown: Locator;
  private deactivateButton: Locator;
  private statusResult: Locator;

  constructor(page: Page) {
    super(page);
    this.userDropdown = this.page.getByLabel('user');
    this.deactivateButton = this.page.getByRole('button', { name: 'Deactivate' });
    this.statusResult = this.page.getByText('Deactivated');
  }

  async expectUserManagementPageVisible() {
    await expect(this.page).toBeVisible();
  }

  async expectUserDetailsVisible() {
    await expect(this.userDropdown).toBeVisible();
  }

  async expectDeactivatedStatusVisible() {
    await expect(this.statusResult).toBeVisible();
  }
}