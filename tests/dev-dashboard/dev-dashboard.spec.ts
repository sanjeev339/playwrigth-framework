import { test } from '../../fixtures/test.fixture';
import { DEV_DASHBOARD_TEST_DATA } from '../../test-data/dev-dashboard/dev-dashboard.data';

test.describe("Dev Dashboard", () => {
  test("TC-DEV-LOGIN-001 - should show dashboard header after login", async ({ devDashboardAction, devDashboardPage }) => {
    await devDashboardAction.performShouldShowDashboardHeaderAfterLogin(DEV_DASHBOARD_TEST_DATA);
    await devDashboardPage.expectDashboardHeaderVisible();
  });
});
