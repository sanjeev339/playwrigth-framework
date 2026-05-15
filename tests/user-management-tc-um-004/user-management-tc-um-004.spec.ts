import { test } from '../../fixtures/test.fixture';
import { USER_MANAGEMENT_TC_UM_004_TEST_DATA } from '../../test-data/user-management-tc-um-004/user-management-tc-um-004.data';

test('Verify deactivation of a user', async ({ userManagementTcUm004Page, userManagementTcUm004Action }) => {
  await userManagementTcUm004Action.performVerifyDeactivationOfAUser(USER_MANAGEMENT_TC_UM_004_TEST_DATA.userId);
  await userManagementTcUm004Page.expectUserManagementPageVisible();
  await userManagementTcUm004Page.expectUserDetailsVisible();
  await userManagementTcUm004Page.expectDeactivatedStatusVisible();
});