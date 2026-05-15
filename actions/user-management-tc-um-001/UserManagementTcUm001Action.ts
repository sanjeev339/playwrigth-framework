import { Page } from '@playwright/test';
import { UserManagementTcUm001Page } from '../../page_objects/user-management-tc-um-001/UserManagementTcUm001Page';
import { LoginAction } from '../../actions/auth/LoginAction';
import { UserManagementTcUm001TestData } from '../../test-data/user-management-tc-um-001/user-management-tc-um-001.data';

export class UserManagementTcUm001Action {
    private readonly userManagementPage: UserManagementTcUm001Page;
    private readonly loginAction: LoginAction;

    constructor(page: Page) {
        this.userManagementPage = new UserManagementTcUm001Page(page);
        this.loginAction = new LoginAction(page);
    }

    async performVerifySuccessfulManualUserCreation(testData: UserManagementTcUm001TestData): Promise<void> {
        await this.loginAction.loginAndWaitForLoad();
        await this.userManagementPage.navigateToUserManagement();
        await this.userManagementPage.addUser(testData.fullName, testData.emailAddress, testData.role);
    }
}
