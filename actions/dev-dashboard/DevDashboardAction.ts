import { Page } from '@playwright/test';
import { DevDashboardPage } from '../../page_objects/dev-dashboard/DevDashboardPage';
import { DevDashboardTestData } from '../../test-data/dev-dashboard/dev-dashboard.data';
import { LoginAction } from '../../actions/auth/LoginAction';
import { Logger } from '../../core/logger/Logger';

export class DevDashboardAction {
  private readonly devDashboardPage: DevDashboardPage;
  private readonly loginAction: LoginAction;


  constructor(page: Page) {
    this.devDashboardPage = new DevDashboardPage(page);
    this.loginAction = new LoginAction(page);

  }

  async performShouldShowDashboardHeaderAfterLogin(data: DevDashboardTestData): Promise<void> {
    Logger.info("Running generated scenario: should show dashboard header after login");
    await this.loginAction.loginAndWaitForLoad();
  }
}
