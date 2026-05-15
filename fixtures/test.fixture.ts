import { test as base } from './page.fixture';
import { LoginAction } from '../actions/auth/LoginAction';
import { GeneratedLoginAction } from '../actions/generated-login/GeneratedLoginAction';
// import { UserManagementAction } from '../actions/user_management/UserManagementAction';

type ActionFixtures = {
    generatedLoginAction: GeneratedLoginAction;
    loginAction: LoginAction;
    // userManagementAction: UserManagementAction;
};

export const test = base.extend<ActionFixtures>({
    generatedLoginAction: async ({ page }, use) => {
        await use(new GeneratedLoginAction(page));
    },
    loginAction: async ({ page }, use) => {
        await use(new LoginAction(page));
    },
    /*
    userManagementAction: async ({ page }, use) => {
        await use(new UserManagementAction(page));
    }
    */
});

export { expect } from '@playwright/test';
