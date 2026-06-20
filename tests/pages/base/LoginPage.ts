import type { Page } from '@playwright/test';
import { BasePage } from './BasePage';
import { getLoginUrl } from '../../actions';

/**
 * Page Object for the Login page.
 * Encapsulates the full login flow used by every test.
 * Used directly in specs OR by authFixture to save storageState.
 */
export class LoginPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async navigate(): Promise<void> {
    await this.page.goto(getLoginUrl());
  }

  async login(email: string, password: string): Promise<void> {
    await this.navigate();

    const emailLocator = this.configuredLocator(process.env.LOGIN_EMAIL_SELECTOR)
      .or(this.page.getByLabel(/email|username/i))
      .or(this.page.getByRole('textbox', { name: /email|username/i }))
      .or(this.page.getByPlaceholder(/email|username/i))
      .first();
    await emailLocator.fill(email);

    const passwordLocator = this.configuredLocator(process.env.LOGIN_PASSWORD_SELECTOR)
      .or(this.page.getByLabel(/password/i))
      .or(this.page.getByRole('textbox', { name: /password/i }))
      .or(this.page.getByPlaceholder(/password/i))
      .first();
    await passwordLocator.fill(password);

    const submitLocator = this.configuredLocator(process.env.LOGIN_SUBMIT_SELECTOR)
      .or(this.page.getByRole('button', { name: /login|sign in|submit/i }))
      .or(this.page.locator('button[type="submit"]'))
      .first();
    await submitLocator.click();
  }
}
