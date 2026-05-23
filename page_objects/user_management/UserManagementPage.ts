import { expect, Locator, Page } from '@playwright/test';
import { BasePage } from '../../core/base/BasePage';

export class UserManagementPage extends BasePage {
    readonly userManagementNav: Locator;
    readonly pageHeading: Locator;
    readonly addUserButton: Locator;
    readonly searchInput: Locator;
    readonly userTable: Locator;
    readonly firstNameInput: Locator;
    readonly lastNameInput: Locator;
    readonly emailInput: Locator;
    readonly phoneInput: Locator;
    readonly roleDropdown: Locator;
    readonly saveButton: Locator;
    readonly closeDrawerButton: Locator;
    readonly roleSearchInput: Locator;
    readonly actionMenuItems: Locator;

    constructor(page: Page) {
        super(page);
        this.userManagementNav = page.getByRole('button', { name: 'User Management' });
        this.pageHeading = page.getByRole('heading', { name: 'Internal Users' });
        this.addUserButton = page.getByRole('button', { name: /Add User/i });
        this.searchInput = page.getByRole('searchbox', { name: 'Search by name or email' });
        this.userTable = page.getByRole('table');
        this.firstNameInput = page.getByRole('textbox', { name: 'Enter first name' });
        this.lastNameInput = page.getByRole('textbox', { name: 'Enter last name' });
        this.emailInput = page.getByRole('textbox', { name: 'Enter email address' });
        this.phoneInput = page.getByRole('textbox', { name: 'Enter Phone Number' });
        this.roleDropdown = page.locator('div').filter({ hasText: /^Select role$/ }).last();
        this.saveButton = page.getByRole('button', { name: /^Save/ });
        this.closeDrawerButton = page.getByRole('button', { name: 'Close' }).or(page.locator('div[role="complementary"] img').first());
        this.roleSearchInput = page.getByRole('searchbox', { name: 'Search' });
        this.actionMenuItems = page.getByRole('menu');
    }

    async gotoUserManagement(): Promise<void> {
        await this.userManagementNav.click();
        await expect(this.pageHeading).toBeVisible({ timeout: 15000 });
    }

    async openAddUserFlow(): Promise<void> {
        await this.addUserButton.click();
        await this.page.getByText('Add Internal User').click();
        await expect(this.page.getByRole('heading', { name: 'Add User' })).toBeVisible();
    }

    async fillUserForm(firstName: string, lastName: string, email: string, phone?: string): Promise<void> {
        await this.firstNameInput.fill(firstName);
        await this.lastNameInput.fill(lastName);
        await this.emailInput.fill(email);
        if (phone) {
            await this.phoneInput.fill(phone);
        }
    }

    async selectRole(roleName: string): Promise<void> {
        await this.roleDropdown.click();
        if (await this.roleSearchInput.isVisible().catch(() => false)) {
            await this.roleSearchInput.fill(roleName);
        }
        await this.page.getByRole('option', { name: roleName }).click();
    }

    async saveUser(): Promise<void> {
        await this.saveButton.click();
    }

    async searchUser(value: string): Promise<void> {
        await this.searchInput.fill(value);
        await this.page.waitForTimeout(1000);
    }

    userRowByEmail(email: string): Locator {
        return this.page.getByRole('row').filter({ hasText: email }).first();
    }

    async openActionMenuForUser(email: string): Promise<void> {
        const row = this.userRowByEmail(email);
        await expect(row).toBeVisible({ timeout: 15000 });
        await row.getByRole('button').first().click();
        await expect(this.actionMenuItems).toBeVisible();
    }

    async clickActionMenuItem(label: 'Edit' | 'Deactivate' | 'Terminate' | 'Reactivate'): Promise<void> {
        await this.page.getByRole('link', { name: label }).click();
    }

    async waitForEditDrawer(): Promise<void> {
        await expect(this.page.getByRole('heading', { name: 'Edit User' })).toBeVisible();
    }

    async updatePhone(phone: string): Promise<void> {
        await this.phoneInput.fill(phone);
    }

    async isRoleDropdownEnabled(): Promise<boolean> {
        return this.page.locator('div[role="complementary"] [role="combobox"]').last().isEnabled().catch(() => false);
    }

    async getToastOrAlertText(): Promise<string> {
        const startTime = Date.now();
        const timeout = 5000;

        while (Date.now() - startTime < timeout) {
            const candidates = [
                this.page.locator('text=/Email already exists/i').first(),
                this.page.locator('.custom-success-toast .success-message').first(),
                this.page.locator('.custom-error-toast .error-message').first(),
                this.page.locator('[class*="toast"]').first(),
                this.page.locator('[role="alert"]').first(),
            ];

            for (const locator of candidates) {
                if (await locator.isVisible().catch(() => false)) {
                    const text = (await locator.textContent())?.trim() ?? '';
                    if (text && !text.toLowerCase().includes('login successful')) {
                        return text;
                    }
                }
            }
            await this.page.waitForTimeout(100);
        }

        return '';
    }

    async closeDrawerIfOpen(): Promise<void> {
        const addHeading = this.page.getByRole('heading', { name: 'Add User' });
        const editHeading = this.page.getByRole('heading', { name: 'Edit User' });
        if (await addHeading.isVisible().catch(() => false) || await editHeading.isVisible().catch(() => false)) {
            await this.page.keyboard.press('Escape');
            await this.page.waitForTimeout(500);
        }
    }

    async getUserRowCountByEmail(email: string): Promise<number> {
        return this.page.getByRole('row').filter({ hasText: email }).count();
    }
}
