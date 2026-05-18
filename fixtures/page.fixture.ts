import { test as base } from '@playwright/test';
import { LoginPage } from '../page_objects/auth/LoginPage';
import { DevDashboardPage } from '../page_objects/dev-dashboard/DevDashboardPage';
import { UserManagementTcUm001Page } from '../page_objects/user-management-tc-um-001/UserManagementTcUm001Page';
import { UserManagementTcUm004Page } from '../page_objects/user-management-tc-um-004/UserManagementTcUm004Page';
import { UserManagementTcUm005Page } from '../page_objects/user-management-tc-um-005/UserManagementTcUm005Page';

type PageFixtures = {
    userManagementTcUm005Page: UserManagementTcUm005Page;
    userManagementTcUm004Page: UserManagementTcUm004Page;
    userManagementTcUm001Page: UserManagementTcUm001Page;
    devDashboardPage: DevDashboardPage;
    loginPage: LoginPage;
};

export const test = base.extend<PageFixtures>({
    userManagementTcUm005Page: async ({ page }, use) => {
        await use(new UserManagementTcUm005Page(page));
    },
    userManagementTcUm004Page: async ({ page }, use) => {
        await use(new UserManagementTcUm004Page(page));
    },
    userManagementTcUm001Page: async ({ page }, use) => {
        await use(new UserManagementTcUm001Page(page));
    },
    devDashboardPage: async ({ page }, use) => {
        await use(new DevDashboardPage(page));
    },
    loginPage: async ({ page }, use) => {
        await use(new LoginPage(page));
    },
});

export { expect } from '@playwright/test';
