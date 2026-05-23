import { test as base } from './page.fixture';
import { IndicatorRepositoryAction } from '../actions/indicator_repository/IndicatorRepositoryAction';
import { LoginAction } from '../actions/auth/LoginAction';
import { UserManagementAction } from '../actions/user_management/UserManagementAction';

type ActionFixtures = {
    indicatorRepositoryAction: IndicatorRepositoryAction;
    loginAction: LoginAction;
    userManagementAction: UserManagementAction;
};

export const test = base.extend<ActionFixtures>({
    indicatorRepositoryAction: async ({ page }, use) => {
        await use(new IndicatorRepositoryAction(page));
    },
    loginAction: async ({ page }, use) => {
        await use(new LoginAction(page));
    },
    userManagementAction: async ({ page }, use) => {
        await use(new UserManagementAction(page));
    }
});

export { expect } from '@playwright/test';
