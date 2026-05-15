import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../../core/base/BasePage';

export class GeneratedLoginPage extends BasePage {
  readonly emailInputLocator: Locator;
  readonly passwordInputLocator: Locator;
  readonly loginButtonLocator: Locator;
  readonly errorMessageLocator: Locator;

  constructor(page: Page) {
    super(page);
    this.emailInputLocator = page.locator("input[name=\"email\"]");
    this.passwordInputLocator = page.locator("input[name=\"password\"]");
    this.loginButtonLocator = page.getByRole("button", { name: "Login" });
    this.errorMessageLocator = page.locator("[class*=\"z-[10000]\"]");
  }

  async goto(url: string): Promise<void> {
    await this.navigateTo(url);
  }

  async expectPageUrl(url: string | RegExp): Promise<void> {
    await expect(this.page).toHaveURL(url);
  }

  async fillEmailInput(value: string): Promise<void> {
    await expect(this.emailInputLocator).toBeVisible();
    await this.emailInputLocator.fill(value);
  }

  async fillPasswordInput(value: string): Promise<void> {
    await expect(this.passwordInputLocator).toBeVisible();
    await this.passwordInputLocator.fill(value);
  }

  async clickLoginButton(): Promise<void> {
    await expect(this.loginButtonLocator).toBeVisible();
    await this.loginButtonLocator.click();
  }

  async expectErrorMessageText(expectedText: string | RegExp): Promise<void> {
    await expect(this.errorMessageLocator).toContainText(expectedText);
  }
}
