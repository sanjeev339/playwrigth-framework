import { test as base } from './page.fixture';
import { LoginAction } from '../actions/auth/LoginAction';
import { DevDashboardAction } from '../actions/dev-dashboard/DevDashboardAction';
import { UserManagementTcUm001Action } from '../actions/user-management-tc-um-001/UserManagementTcUm001Action';

type ActionFixtures = {
    userManagementTcUm001Action: UserManagementTcUm001Action;
    devDashboardAction: DevDashboardAction;
    loginAction: LoginAction;
};

export const test = base.extend<ActionFixtures>({
    userManagementTcUm001Action: async ({ page }, use) => {
        await use(new UserManagementTcUm001Action(page));
    },
    devDashboardAction: async ({ page }, use) => {
        await use(new DevDashboardAction(page));
    },
    loginAction: async ({ page }, use) => {
        await use(new LoginAction(page));
    },
});

export { expect } from '@playwright/test';
