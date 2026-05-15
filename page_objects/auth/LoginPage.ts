import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../../core/base/BasePage';
import { ConfigManager } from '../../core/config/ConfigManager';

export class LoginPage extends BasePage {
    readonly usernameInput: Locator;
    readonly passwordInput: Locator;
    readonly loginButton: Locator;
    readonly errorToast: Locator;
    readonly dashboardHeading: Locator;

    constructor(page: Page) {
        super(page);
        this.usernameInput = page.locator('input[name="email"]');
        this.passwordInput = page.locator('input[name="password"]');
        this.loginButton = page.getByRole('button', { name: /^Login$/ });
        this.errorToast = page.locator('[class*="z-[10000]"]');
        this.dashboardHeading = page.getByRole('heading', { name: 'Dashboard' });
    }

    async goto(): Promise<void> {
        await this.navigateTo(ConfigManager.BASE_URL!);
    }

    async fillUsername(username: string): Promise<void> {
        await expect(this.usernameInput).toBeVisible();
        await this.usernameInput.fill(username);
    }

    async fillPassword(password: string): Promise<void> {
        await expect(this.passwordInput).toBeVisible();
        await this.passwordInput.fill(password);
    }

    async clickLogin(): Promise<void> {
        await expect(this.loginButton).toBeVisible();
        await this.loginButton.click();
    }

    async getErrorMessage(): Promise<string> {
        const inlineError = this.page
            .locator('.text-red-500, .error-message, .p-error')
            .first();
        if (await inlineError.isVisible()) {
            return (await inlineError.textContent())?.trim() ?? '';
        }
        return await this.getToastMessage('error');
    }

    async loginFlow(username: string, password: string): Promise<void> {
        await this.goto();
        await this.fillUsername(username);
        await this.fillPassword(password);
        await this.clickLogin();
    }

    async waitForPostLoginReady(): Promise<void> {
        await expect(this.dashboardHeading).toBeVisible({ timeout: 20_000 });
    }
}
