import { test } from '../../fixtures/test.fixture';
import { USER_MANAGEMENT_TC_UM_001_TEST_DATA } from '../../test-data/user-management-tc-um-001/user-management-tc-um-001.data';

test.describe("User Management TC-UM-001", () => {
  test("TC-UM-001 - Verify successful manual user creation", async ({ userManagementTcUm001Action, userManagementTcUm001Page }) => {
    await userManagementTcUm001Action.performVerifySuccessfulManualUserCreation(USER_MANAGEMENT_TC_UM_001_TEST_DATA);
    await userManagementTcUm001Page.expectStatusResultText(String(USER_MANAGEMENT_TC_UM_001_TEST_DATA.status));
  });
});
