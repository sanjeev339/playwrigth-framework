import { test as base } from './page.fixture';
import { LoginAction } from '../actions/auth/LoginAction';
import { DevDashboardAction } from '../actions/dev-dashboard/DevDashboardAction';
import { UserManagementTcUm001Action } from '../actions/user-management-tc-um-001/UserManagementTcUm001Action';
import { UserManagementTcUm004Action } from '../actions/user-management-tc-um-004/UserManagementTcUm004Action';
import { UserManagementTcUm005Action } from '../actions/user-management-tc-um-005/UserManagementTcUm005Action';

type ActionFixtures = {
    userManagementTcUm005Action: UserManagementTcUm005Action;
    userManagementTcUm004Action: UserManagementTcUm004Action;
    userManagementTcUm001Action: UserManagementTcUm001Action;
    devDashboardAction: DevDashboardAction;
    loginAction: LoginAction;
};

export const test = base.extend<ActionFixtures>({
    userManagementTcUm005Action: async ({ page }, use) => {
        await use(new UserManagementTcUm005Action(page));
    },
    userManagementTcUm004Action: async ({ page }, use) => {
        await use(new UserManagementTcUm004Action(page));
    },
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
