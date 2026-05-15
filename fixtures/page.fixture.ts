import { test as base } from '@playwright/test';
import { LoginPage } from '../page_objects/auth/LoginPage';
import { GeneratedLoginPage } from '../page_objects/generated-login/GeneratedLoginPage';
// import { UserManagementPage } from '../page_objects/user_management/UserManagementPage';

type PageFixtures = {
    generatedLoginPage: GeneratedLoginPage;
    loginPage: LoginPage;
    // userManagementPage: UserManagementPage;
};

export const test = base.extend<PageFixtures>({
    generatedLoginPage: async ({ page }, use) => {
        await use(new GeneratedLoginPage(page));
    },
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
