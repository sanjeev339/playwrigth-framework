import { test as base } from './page.fixture';
import { LoginAction } from '../actions/auth/LoginAction';
// import { UserManagementAction } from '../actions/user_management/UserManagementAction';

type ActionFixtures = {
    loginAction: LoginAction;
    // userManagementAction: UserManagementAction;
};

export const test = base.extend<ActionFixtures>({
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
