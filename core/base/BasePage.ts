import { Page, Locator } from '@playwright/test';

export class BasePage {
    protected readonly page: Page;

    constructor(page: Page) {
        this.page = page;
    }

    async navigateTo(path: string) {
        await this.page.goto(path);
    }

    async waitForElement(selector: string, timeout = 10000) {
        await this.page.waitForSelector(selector, { state: 'visible', timeout });
    }

    async isElementVisible(selector: string): Promise<boolean> {
        return await this.page.locator(selector).isVisible();
    }

    async click(selector: string) {
        await this.page.click(selector);
    }

    async fill(selector: string, value: string) {
        await this.page.fill(selector, value);
    }

    async clearAndFill(selector: string, value: string) {
        const locator = this.page.locator(selector);
        await locator.click();
        await this.page.keyboard.press('Control+A');
        await this.page.keyboard.press('Backspace');
        await locator.fill(value);
    }

    async getToastMessage(type: 'success' | 'error' = 'success'): Promise<string> {
        const selector = type === 'success'
            ? '.custom-success-toast .success-message'
            : '.custom-error-toast .error-message';

        const toastLocator = this.page.locator(selector);
        try {
            await toastLocator.waitFor({ state: 'visible', timeout: 5000 });
            const message = await toastLocator.textContent();
            return message?.trim() || "";
        } catch (error) {
            return "";
        }
    }

    async takeScreenshot(name: string) {
        await this.page.screenshot({
            path: `./reports/screenshots/${name}-${Date.now()}.png`,
            fullPage: true
        });
    }
}
