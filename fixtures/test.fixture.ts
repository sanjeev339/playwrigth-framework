import { test as base } from './page.fixture';
import { LoginAction } from '../actions/auth/LoginAction';
import { DevDashboardAction } from '../actions/dev-dashboard/DevDashboardAction';
type ActionFixtures = {
    devDashboardAction: DevDashboardAction;
    loginAction: LoginAction;
};

export const test = base.extend<ActionFixtures>({
    devDashboardAction: async ({ page }, use) => {
        await use(new DevDashboardAction(page));
    },
    loginAction: async ({ page }, use) => {
        await use(new LoginAction(page));
    },
});

export { expect } from '@playwright/test';
