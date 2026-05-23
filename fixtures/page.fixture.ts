import { test as base } from '@playwright/test';
import { LoginPage } from '../page_objects/auth/LoginPage';
import { IndicatorRepositoryPage } from '../page_objects/indicator_repository/IndicatorRepositoryPage';
import { UserManagementPage } from '../page_objects/user_management/UserManagementPage';

type PageFixtures = {
    loginPage: LoginPage;
    indicatorRepositoryPage: IndicatorRepositoryPage;
    userManagementPage: UserManagementPage;
};

export const test = base.extend<PageFixtures>({
    loginPage: async ({ page }, use) => {
        await use(new LoginPage(page));
    },
    indicatorRepositoryPage: async ({ page }, use) => {
        await use(new IndicatorRepositoryPage(page));
    },
    userManagementPage: async ({ page }, use) => {
        await use(new UserManagementPage(page));
    }
});

export { expect } from '@playwright/test';
