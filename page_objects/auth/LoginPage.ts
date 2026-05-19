import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../../core/base/BasePage';
import { ConfigManager } from '../../core/config/ConfigManager';

export class LoginPage extends BasePage {
    /**
     * Username / email input
     * Tier 1: label / placeholder semantic locator.
     * Tier 2: name="email", type="email", id pattern.
     * Tier 3: XPath by name attr; relative XPath inside form.
     */
    readonly usernameInputCandidates: Locator[];

    /**
     * Password input
     * Tier 1: label / placeholder semantic locator.
     * Tier 2: name="password", type="password".
     * Tier 3: XPath by type; relative XPath inside form.
     */
    readonly passwordInputCandidates: Locator[];

    /**
     * Login submit button
     * Tier 1: role + exact name.
     * Tier 2: type=submit, text match.
     * Tier 3: XPath button by text; relative XPath inside form.
     */
    readonly loginButtonCandidates: Locator[];

    /**
     * Error toast / inline error message
     * Tier 1: ARIA role="alert".
     * Tier 2: common Tailwind / PrimeReact error class names.
     * Tier 3: XPath by role attribute.
     */
    readonly errorToastCandidates: Locator[];

    /**
     * Dashboard heading shown after successful login
     * Tier 1: role + name.
     * Tier 2: heading tags with text.
     * Tier 3: XPath by text content.
     */
    readonly dashboardHeadingCandidates: Locator[];

    constructor(page: Page) {
        super(page);

        this.usernameInputCandidates = [
            page.getByLabel(/email/i),
            page.getByPlaceholder(/email/i),
            page.locator('input[name="email"]'),
            page.locator('input[type="email"]'),
            page.locator('input[id*="email"]'),
            page.locator('xpath=//input[@name="email"]'),
            page.locator('xpath=//form//input[@type="email"]'),
        ];

        this.passwordInputCandidates = [
            page.getByLabel(/password/i),
            page.getByPlaceholder(/password/i),
            page.locator('input[name="password"]'),
            page.locator('input[type="password"]'),
            page.locator('input[id*="password"]'),
            page.locator('xpath=//input[@name="password"]'),
            page.locator('xpath=//form//input[@type="password"]'),
        ];

        this.loginButtonCandidates = [
            page.getByRole('button', { name: /^login$/i }),
            page.locator('button[type="submit"]'),
            page.locator('button:has-text("Login")'),
            page.locator('[class*="login"] button'),
            page.locator('xpath=//button[normalize-space()="Login"]'),
            page.locator('xpath=//form//button[@type="submit"]'),
        ];

        this.errorToastCandidates = [
            page.getByRole('alert'),
            page.locator('.text-red-500'),
            page.locator('.p-error'),
            page.locator('.error-message'),
            page.locator('[class*="error"]').first(),
            page.locator('xpath=//*[@role="alert"]'),
            page.locator('xpath=//*[contains(@class,"error")]'),
        ];

        this.dashboardHeadingCandidates = [
            page.getByRole('heading', { name: /^dashboard$/i }),
            page.locator('h1:has-text("Dashboard")'),
            page.locator('h2:has-text("Dashboard")'),
            page.locator('[class*="page-title"]:has-text("Dashboard")'),
            page.locator('xpath=//h1[normalize-space()="Dashboard"]'),
            page.locator('xpath=//*[contains(@class,"dashboard-header")]'),
        ];
    }

    // Convenience single-locator accessors used by LoginAction
    get dashboardHeading(): Locator {
        return this.page.getByRole('heading', { name: /^dashboard$/i });
    }

    async goto(): Promise<void> {
        await this.navigateTo(ConfigManager.BASE_URL);
    }

    async fillUsername(username: string): Promise<void> {
        const locator = await this.firstVisibleLocator('username input', this.usernameInputCandidates);
        await locator.fill(username);
    }

    async fillPassword(password: string): Promise<void> {
        const locator = await this.firstVisibleLocator('password input', this.passwordInputCandidates);
        await locator.fill(password);
    }

    async clickLogin(): Promise<void> {
        const locator = await this.firstVisibleLocator('login button', this.loginButtonCandidates);
        await locator.click();
    }

    async getErrorMessage(): Promise<string> {
        // Try inline field-level errors first, then fall back to toast
        const inlineError = this.page
            .locator('.text-red-500, .error-message, .p-error, [class*="error-text"]')
            .first();
        if (await inlineError.isVisible()) {
            return (await inlineError.textContent())?.trim() ?? '';
        }
        return this.getToastMessage('error');
    }

    async loginFlow(username: string, password: string): Promise<void> {
        await this.goto();
        await this.fillUsername(username);
        await this.fillPassword(password);
        await this.clickLogin();
    }

    async waitForPostLoginReady(): Promise<void> {
        const locator = await this.firstVisibleLocator('dashboard heading', this.dashboardHeadingCandidates, 20_000);
        await expect(locator).toBeVisible({ timeout: 20_000 });
    }
}
