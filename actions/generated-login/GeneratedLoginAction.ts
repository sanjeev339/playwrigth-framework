import { Page } from '@playwright/test';
import { GeneratedLoginPage } from '../../page_objects/generated-login/GeneratedLoginPage';
import { GeneratedLoginTestData } from '../../test-data/generated-login/generated-login.data';
import { Logger } from '../../core/logger/Logger';

export class GeneratedLoginAction {
  private readonly generatedLoginPage: GeneratedLoginPage;

  constructor(page: Page) {
    this.generatedLoginPage = new GeneratedLoginPage(page);
  }

  async performShouldShowErrorForInvalidCredentials(data: GeneratedLoginTestData): Promise<void> {
    Logger.info("Running generated scenario: should show error for invalid credentials");
    await this.generatedLoginPage.goto(String(data.loginUrl));
    await this.generatedLoginPage.fillEmailInput(String(data.username));
    await this.generatedLoginPage.fillPasswordInput(String(data.password));
    await this.generatedLoginPage.clickLoginButton();
  }
}
