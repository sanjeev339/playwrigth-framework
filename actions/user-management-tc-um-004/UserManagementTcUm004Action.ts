import { Page } from '@playwright/test';
import { UserManagementTcUm004Page } from '../../page_objects/user-management-tc-um-004/UserManagementTcUm004Page';
import { LoginAction } from '../../actions/auth/LoginAction';

export class UserManagementTcUm004Action {
  private page: UserManagementTcUm004Page;
  private loginAction: LoginAction;

  constructor(page: Page) {
    this.loginAction = new LoginAction(page);
    this.loginAction.loginAndWaitForLoad();
    this.page = new UserManagementTcUm004Page(page);
  }

  async performVerifyDeactivationOfAUser(userId: string) {
    await this.page.userDropdown.selectOption(userId);
    await this.page.deactivateButton.click();
  }
}