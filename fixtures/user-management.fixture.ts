/**
 * user-management.fixture.ts
 *
 * Extends the base test fixture chain:
 *   @playwright/test  →  page.fixture  →  test.fixture (loginAction)  →  THIS
 *
 * Injects UserManagementPage and UserManagementAction into every test
 * that imports from this fixture file.
 */
import { test as base } from './test.fixture';
import { UserManagementPage } from '../page_objects/user_management/UserManagementPage';
import { UserManagementAction } from '../actions/user_management/UserManagementAction';

type UserManagementFixtures = {
  userManagementPage: UserManagementPage;
  userManagementAction: UserManagementAction;
};

export const test = base.extend<UserManagementFixtures>({
  /**
   * Provides a UserManagementPage instance scoped to the current test's page.
   * Page Objects are stateless — safe for parallel execution.
   */
  userManagementPage: async ({ page }, use) => {
    await use(new UserManagementPage(page));
  },

  /**
   * Provides a UserManagementAction instance wired to userManagementPage.
   * Actions depend on Page Objects — Playwright injects userManagementPage first.
   */
  userManagementAction: async ({ userManagementPage }, use) => {
    await use(new UserManagementAction(userManagementPage));
  },
});

export { expect } from '@playwright/test';
