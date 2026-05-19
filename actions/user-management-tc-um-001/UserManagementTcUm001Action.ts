import { Page } from '@playwright/test';
import { UserManagementTcUm001Page } from '../../page_objects/user-management-tc-um-001/UserManagementTcUm001Page';
import { UserManagementTcUm001TestData } from '../../test-data/user-management-tc-um-001/user-management-tc-um-001.data';
import { LoginAction } from '../../actions/auth/LoginAction';
import { Logger } from '../../core/logger/Logger';

export class UserManagementTcUm001Action {
  private readonly userManagementTcUm001Page: UserManagementTcUm001Page;
  private readonly loginAction: LoginAction;


  constructor(page: Page) {
    this.userManagementTcUm001Page = new UserManagementTcUm001Page(page);
    this.loginAction = new LoginAction(page);

  }

  async performVerifySuccessfulManualUserCreation(data: UserManagementTcUm001TestData): Promise<void> {
    Logger.info("Running generated scenario: Verify successful manual user creation");
    await this.loginAction.loginAndWaitForLoad();
    await this.userManagementTcUm001Page.clickUserManagementNavigation();
    await this.userManagementTcUm001Page.clickAddUserButton();
    await this.userManagementTcUm001Page.clickAddInternalUser();
    await this.userManagementTcUm001Page.fillFirstNameInput(String(data.firstName));
    await this.userManagementTcUm001Page.fillLastNameInput(String(data.lastName));
    await this.userManagementTcUm001Page.fillEmailAddressInput(String(data.emailAddress));
    await this.userManagementTcUm001Page.selectRoleDropdown(String(data.role));
    await this.userManagementTcUm001Page.clickSaveButton();
  }
}
