import { test as base } from '@playwright/test';
import { LoginPage } from '../page_objects/auth/LoginPage';
// import { UserManagementPage } from '../page_objects/user_management/UserManagementPage';

type PageFixtures = {
    loginPage: LoginPage;
    // userManagementPage: UserManagementPage;
};

export const test = base.extend<PageFixtures>({
    loginPage: async ({ page }, use) => {
        await use(new LoginPage(page));
    },
    /*
    userManagementPage: async ({ page }, use) => {
        await use(new UserManagementPage(page));
    }
    */
});

export { expect } from '@playwright/test';
