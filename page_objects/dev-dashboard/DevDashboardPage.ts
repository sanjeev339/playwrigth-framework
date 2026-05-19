import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../../core/base/BasePage';

export class DevDashboardPage extends BasePage {
    /**
     * Dashboard page heading
     * Tier 1: role + name semantic locator.
     * Tier 2: CSS heading tags with text, class-based title.
     * Tier 3: XPath absolute; relative XPath inside main content.
     */
    readonly dashboardHeaderLocatorCandidates: Locator[];

    constructor(page: Page) {
        super(page);

        this.dashboardHeaderLocatorCandidates = [
            page.getByRole('heading', { name: /^dashboard$/i }),
            page.locator('h1:has-text("Dashboard")'),
            page.locator('h2:has-text("Dashboard")'),
            page.locator('[class*="page-title"]:has-text("Dashboard")'),
            page.locator('[class*="header"]:has-text("Dashboard")'),
            page.locator('xpath=//h1[normalize-space()="Dashboard"]'),
            page.locator('xpath=//main//*[contains(@class,"title") and contains(text(),"Dashboard")]'),
        ];
    }

    // Single-locator accessor kept for backward compatibility with LoginAction
    get dashboardHeaderLocator(): Locator {
        return this.page.getByRole('heading', { name: /^dashboard$/i });
    }

    async goto(url: string): Promise<void> {
        await this.navigateTo(url);
    }

    async expectPageUrl(url: string | RegExp): Promise<void> {
        await expect(this.page).toHaveURL(url);
    }

    async expectDashboardHeaderVisible(): Promise<void> {
        const locator = await this.firstVisibleLocator('dashboard header', this.dashboardHeaderLocatorCandidates, 15_000);
        await expect(locator).toBeVisible();
    }
}
