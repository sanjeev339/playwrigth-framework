import { test as base, expect, Page } from '@playwright/test';
import { IndicatorRepositoryAction } from '../actions/indicator_repository/IndicatorRepositoryAction';
import { LoginAction } from '../actions/auth/LoginAction';
import { IndicatorRepositoryPage } from '../page_objects/indicator_repository/IndicatorRepositoryPage';

type IndicatorRepositoryFixtures = {
    indicatorRepositoryAction: IndicatorRepositoryAction;
    indicatorRepositoryPage: IndicatorRepositoryPage;
};

type IndicatorRepositoryWorkerFixtures = {
    sharedPage: Page;
};

export const test = base.extend<IndicatorRepositoryFixtures, IndicatorRepositoryWorkerFixtures>({
    sharedPage: [
        async ({ browser }, use) => {
            const context = await browser.newContext();
            const page = await context.newPage();

            try {
                await new LoginAction(page).loginAndWaitForLoad();
                await use(page);
            } finally {
                await page.close();
                await context.close();
            }
        },
        { scope: 'worker', timeout: 60_000 },
    ],
    page: async ({ sharedPage }, use) => {
        await use(sharedPage);
    },
    indicatorRepositoryPage: async ({ page }, use) => {
        await use(new IndicatorRepositoryPage(page));
    },
    indicatorRepositoryAction: async ({ page }, use) => {
        await use(new IndicatorRepositoryAction(page));
    },
});

export { expect };
