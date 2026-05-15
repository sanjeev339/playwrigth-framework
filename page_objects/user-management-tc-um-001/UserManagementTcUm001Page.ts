import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../../core/base/BasePage';

export class UserManagementTcUm001Page extends BasePage {
    readonly settingsNav: Locator;
    readonly userManagementNav: Locator;
    readonly addUserButton: Locator;
    readonly fullNameInput: Locator;
    readonly emailAddressInput: Locator;
    readonly roleDropdown: Locator;
    readonly saveButton: Locator;
    readonly statusResult: Locator;

    constructor(page: Page) {
        super(page);
        this.settingsNav = page.getByText('Settings', { exact: false });
        this.userManagementNav = page.getByText('User Management', { exact: false });
        this.addUserButton = page.getByRole('button', { name: 'Add User' });
        this.fullNameInput = page.getByLabel('Full Name');
        this.emailAddressInput = page.getByLabel('Email Address');
        this.roleDropdown = page.getByLabel('Role');
        this.saveButton = page.getByRole('button', { name: 'Save' });
        this.statusResult = page.getByText('Pending');
    }

    async navigateToUserManagement() {
        await expect(this.settingsNav).toBeVisible();
        await this.settingsNav.click();
        await expect(this.userManagementNav).toBeVisible();
        await this.userManagementNav.click();
    }

    async addUser(fullName: string, emailAddress: string, role: string) {
        await expect(this.addUserButton).toBeVisible();
        await this.addUserButton.click();
        await expect(this.fullNameInput).toBeVisible();
        await this.fullNameInput.fill(fullName);
        await expect(this.emailAddressInput).toBeVisible();
        await this.emailAddressInput.fill(emailAddress);
        await expect(this.roleDropdown).toBeVisible();
        await this.roleDropdown.selectOption(role);
        await expect(this.saveButton).toBeVisible();
        await this.saveButton.click();
    }

    async verifyUserStatus(expectedStatus: string) {
        await expect(this.statusResult).toBeVisible();
        await expect(this.statusResult).toHaveText(expectedStatus);
    }
}
