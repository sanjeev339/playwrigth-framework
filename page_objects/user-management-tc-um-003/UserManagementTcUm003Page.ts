import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../../core/base/BasePage';

export class UserManagementTcUm003Page extends BasePage {
    readonly settingsNavigation: Locator;
    readonly userManagementNavigation: Locator;
    readonly userSelector: Locator;
    readonly roleSelector: Locator;
    readonly saveButton: Locator;

    constructor(page: Page) {
        super(page);
        this.settingsNavigation = page.getByText('Settings', { exact: false });
        this.userManagementNavigation = page.getByText('User Management', { exact: false });
        this.userSelector = page.getByLabel(/user/i);
        this.roleSelector = page.getByLabel(/role/i);
        this.saveButton = page.getByRole('button', { name: /save/i });
    }

    async navigateToUserManagement(): Promise<void> {
        await expect(this.settingsNavigation).toBeVisible();
        await this.settingsNavigation.click();
        await expect(this.userManagementNavigation).toBeVisible();
        await this.userManagementNavigation.click();
    }

    async selectUser(userId: string): Promise<void> {
        await expect(this.userSelector).toBeVisible();
        await this.userSelector.selectOption(userId);
    }

    async selectRole(role: string): Promise<void> {
        await expect(this.roleSelector).toBeVisible();
        await this.roleSelector.selectOption(role);
    }

    async saveRoleAssignment(): Promise<void> {
        await expect(this.saveButton).toBeVisible();
        await this.saveButton.click();
    }

    async expectAssignedRoleVisible(role: string): Promise<void> {
        await expect(this.page.getByText(role, { exact: false })).toBeVisible();
    }
}
