import { test as base } from '@playwright/test';
import { LoginPage } from '../page_objects/auth/LoginPage';

type PageFixtures = {
    loginPage: LoginPage;
};

export const test = base.extend<PageFixtures>({
    loginPage: async ({ page }, use) => {
        await use(new LoginPage(page));
    }
});

export { expect } from '@playwright/test';
