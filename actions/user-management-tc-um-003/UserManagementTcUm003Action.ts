import { Page } from '@playwright/test';
import { LoginAction } from '../../actions/auth/LoginAction';
import { UserManagementTcUm003Page } from '../../page_objects/user-management-tc-um-003/UserManagementTcUm003Page';
import { UserManagementTcUm003TestData } from '../../test-data/user-management-tc-um-003/user-management-tc-um-003.data';

export class UserManagementTcUm003Action {
    private readonly loginAction: LoginAction;
    private readonly userManagementPage: UserManagementTcUm003Page;

    constructor(page: Page) {
        this.loginAction = new LoginAction(page);
        this.userManagementPage = new UserManagementTcUm003Page(page);
    }

    async performVerifyRoleAssignmentToUser(data: UserManagementTcUm003TestData): Promise<void> {
        await this.loginAction.loginAndWaitForLoad();
        await this.userManagementPage.navigateToUserManagement();
        await this.userManagementPage.selectUser(data.userId);
        await this.userManagementPage.selectRole(data.role);
        await this.userManagementPage.saveRoleAssignment();
    }
}
