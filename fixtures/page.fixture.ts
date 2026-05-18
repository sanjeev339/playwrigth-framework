import { test as base } from '@playwright/test';
import { LoginPage } from '../page_objects/auth/LoginPage';
import { DevDashboardPage } from '../page_objects/dev-dashboard/DevDashboardPage';

type PageFixtures = {
    devDashboardPage: DevDashboardPage;
    loginPage: LoginPage;
};

export const test = base.extend<PageFixtures>({
    devDashboardPage: async ({ page }, use) => {
        await use(new DevDashboardPage(page));
    },
    loginPage: async ({ page }, use) => {
        await use(new LoginPage(page));
    },
});

export { expect } from '@playwright/test';
