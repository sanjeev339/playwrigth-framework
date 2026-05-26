import { test as base } from './page.fixture';
import { LoginAction } from '../actions/auth/LoginAction';

type ActionFixtures = {
    loginAction: LoginAction;
};

export const test = base.extend<ActionFixtures>({
    loginAction: async ({ page }, use) => {
        await use(new LoginAction(page));
    }
});

export { expect } from '@playwright/test';
