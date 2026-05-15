import { test } from '../../fixtures/test.fixture';
import { USER_MANAGEMENT_TC_UM_003_TEST_DATA } from '../../test-data/user-management-tc-um-003/user-management-tc-um-003.data';

test.describe('User Management TC-UM-003', () => {
    test('TC-UM-003 - Verify role assignment to user', async ({
        userManagementTcUm003Action,
        userManagementTcUm003Page,
    }) => {
        await userManagementTcUm003Action.performVerifyRoleAssignmentToUser(
            USER_MANAGEMENT_TC_UM_003_TEST_DATA,
        );
        await userManagementTcUm003Page.expectAssignedRoleVisible(
            USER_MANAGEMENT_TC_UM_003_TEST_DATA.role,
        );
    });
});
