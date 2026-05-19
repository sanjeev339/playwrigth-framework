import { Page, Locator } from '@playwright/test';
import * as fs from 'fs';

export class BasePage {
    protected readonly page: Page;

    constructor(page: Page) {
        this.page = page;
    }

    async navigateTo(path: string): Promise<void> {
        await this.page.goto(path);
    }

    async waitForElement(selector: string, timeout = 10000): Promise<void> {
        await this.page.waitForSelector(selector, { state: 'visible', timeout });
    }

    async isElementVisible(selector: string): Promise<boolean> {
        return this.page.locator(selector).isVisible();
    }

    async clearAndFill(locator: Locator, value: string): Promise<void> {
        await locator.click();
        await this.page.keyboard.press('Control+A');
        await this.page.keyboard.press('Backspace');
        await locator.fill(value);
    }

    /**
     * Clicks a dropdown option by value after the dropdown trigger has been opened.
     * Tries scoped overlay candidates first so repeated page text cannot cause
     * Playwright strict mode failures.
     */
    protected async clickVisibleDropdownOption(value: string): Promise<void> {
        const panel = this.page.locator([
            '.p-multiselect-panel',
            '.p-dropdown-panel',
            '.p-select-panel',
            '[role="listbox"]',
        ].join(', ')).last();

        const candidates: Locator[] = [
            panel.getByRole('option', { name: value, exact: true }),
            panel.getByRole('checkbox', { name: value, exact: true }),
            panel.getByText(value, { exact: true }),
            panel.locator(`li:has-text("${value}")`),
            panel.locator(`[class*="option"]:has-text("${value}")`),
            panel.locator(`xpath=.//*[@role="option" and normalize-space()="${value}"]`),
            panel.locator(`xpath=.//li[normalize-space()="${value}"]`),
        ];
        const option = await this.firstVisibleLocator(`dropdown option "${value}"`, candidates);
        await option.click();
    }

    protected async firstVisibleLocator(
        purpose: string,
        candidates: Locator[],
        timeoutPerCandidate = 1500,
    ): Promise<Locator> {
        const failures: string[] = [];

        for (const candidate of candidates) {
            const firstMatch = candidate.first();
            try {
                await firstMatch.waitFor({ state: 'visible', timeout: timeoutPerCandidate });
                return firstMatch;
            } catch (error) {
                const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
                failures.push(message);
            }
        }

        throw new Error(
            `No visible locator found for ${purpose}. Tried ${candidates.length} tiered locator candidates. ${failures.join(' | ')}`,
        );
    }

    async getToastMessage(type: 'success' | 'error' = 'success'): Promise<string> {
        const selector = type === 'success'
            ? '.custom-success-toast .success-message'
            : '.custom-error-toast .error-message';

        const toastLocator = this.page.locator(selector);
        try {
            await toastLocator.waitFor({ state: 'visible', timeout: 5000 });
            const message = await toastLocator.textContent();
            return message?.trim() || '';
        } catch {
            return '';
        }
    }

    async takeScreenshot(name: string): Promise<void> {
        const dir = './reports/screenshots';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        await this.page.screenshot({
            path: `${dir}/${name}-${Date.now()}.png`,
            fullPage: true,
        });
    }

    // ── Deprecated helpers ─────────────────────────────────────────────────────
    // These accept raw CSS strings and bypass Playwright's typed Locator API.
    // Prefer declaring named Locators in your Page Object constructor instead.

    /** @deprecated Use a typed Locator from the page object constructor. */
    async click(selector: string): Promise<void> {
        await this.page.click(selector);
    }

    /** @deprecated Use a typed Locator from the page object constructor. */
    async fill(selector: string, value: string): Promise<void> {
        await this.page.fill(selector, value);
    }
}
