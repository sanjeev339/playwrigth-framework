import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../../core/base/BasePage';

export class UserManagementTcUm001Page extends BasePage {
  /**
   * User Management navigation
   * Tier 1: semantic locator from DOM recon.
   * Tier 2: scoped text/attribute fallback.
   * Tier 3: XPath fallback only inside this candidate array.
   */
  readonly userManagementNavigationLocatorCandidates: Locator[];
  /**
   * Add User button
   * Tier 1: semantic locator from DOM recon.
   * Tier 2: scoped text/attribute fallback.
   * Tier 3: XPath fallback only inside this candidate array.
   */
  readonly addUserButtonLocatorCandidates: Locator[];
  /**
   * Add Internal User
   * Tier 1: semantic locator from DOM recon.
   * Tier 2: scoped text/attribute fallback.
   * Tier 3: XPath fallback only inside this candidate array.
   */
  readonly addInternalUserLocatorCandidates: Locator[];
  /**
   * First Name input
   * Tier 1: semantic locator from DOM recon.
   * Tier 2: scoped text/attribute fallback.
   * Tier 3: XPath fallback only inside this candidate array.
   */
  readonly firstNameInputLocatorCandidates: Locator[];
  /**
   * Last Name input
   * Tier 1: semantic locator from DOM recon.
   * Tier 2: scoped text/attribute fallback.
   * Tier 3: XPath fallback only inside this candidate array.
   */
  readonly lastNameInputLocatorCandidates: Locator[];
  /**
   * Email Address input
   * Tier 1: semantic locator from DOM recon.
   * Tier 2: scoped text/attribute fallback.
   * Tier 3: XPath fallback only inside this candidate array.
   */
  readonly emailAddressInputLocatorCandidates: Locator[];
  /**
   * Role dropdown
   * Tier 1: semantic locator from DOM recon.
   * Tier 2: scoped text/attribute fallback.
   * Tier 3: XPath fallback only inside this candidate array.
   */
  readonly roleDropdownLocatorCandidates: Locator[];
  /**
   * Save button
   * Tier 1: semantic locator from DOM recon.
   * Tier 2: scoped text/attribute fallback.
   * Tier 3: XPath fallback only inside this candidate array.
   */
  readonly saveButtonLocatorCandidates: Locator[];
  /**
   * status result
   * Tier 1: semantic locator from DOM recon.
   * Tier 2: scoped text/attribute fallback.
   * Tier 3: XPath fallback only inside this candidate array.
   */
  readonly statusResultLocatorCandidates: Locator[];

  constructor(page: Page) {
    super(page);
    this.userManagementNavigationLocatorCandidates = [
      page.getByRole("link", { name: /^User Management$/ }),
      page.getByRole("menuitem", { name: /^User Management$/ }),
      page.getByRole("button", { name: /^User Management$/ }),
      page.getByText("User Management", { exact: true }),
      page.locator("[class*=sidebar]").getByText("User Management", { exact: true }),
      page.getByText("User Management", { exact: false }),
      page.locator("xpath=//*[contains(@class,\"sidebar\")]//*[normalize-space()=\"User Management\"]"),
    ];

    this.addUserButtonLocatorCandidates = [
      page.getByRole("button", { name: "Add User", exact: true }),
      page.getByRole("button", { name: /^Add User$/i }),
      page.locator("xpath=//button[normalize-space()=\"Add User\"]"),
    ];

    this.addInternalUserLocatorCandidates = [
      page.getByText("Add Internal User", { exact: true }),
      page.locator('[role="dialog"]').getByText("Add Internal User", { exact: true }),
      page.locator("xpath=//*[@role=\"dialog\"]//*[normalize-space()=\"Add Internal User\"]"),
    ];

    this.firstNameInputLocatorCandidates = [
      page.getByPlaceholder("Enter first name"),
      page.getByLabel(/^First Name/i),
      page.locator('input[name="firstName"]'),
      page.locator("xpath=//input[@placeholder=\"Enter first name\"]"),
    ];

    this.lastNameInputLocatorCandidates = [
      page.getByPlaceholder("Enter last name"),
      page.getByLabel(/^Last Name/i),
      page.locator('input[name="lastName"]'),
      page.locator("xpath=//input[@placeholder=\"Enter last name\"]"),
    ];

    this.emailAddressInputLocatorCandidates = [
      page.getByPlaceholder("Enter email address"),
      page.getByLabel(/^Email Address/i),
      page.locator('input[type="email"]'),
      page.getByLabel("Email Address"),
      page.locator("xpath=//input[@placeholder=\"Enter email address\"]"),
    ];

    this.roleDropdownLocatorCandidates = [
      page.getByText("Select role", { exact: true }),
      page.getByRole("combobox", { name: /role/i }),
      page.locator('[class*=role]').getByText("Select role", { exact: true }),
      page.getByRole("combobox", { name: "Role", exact: false }),
      page.locator("xpath=//*[normalize-space()=\"Role\"]/ancestor::*[contains(@class,\"field\") or contains(@class,\"form\")]//*[normalize-space()=\"Select role\"]"),
    ];

    this.saveButtonLocatorCandidates = [
      page.getByRole("button", { name: /^Save/i }),
      page.locator('button[type="submit"]'),
      page.getByRole("button", { name: "Save", exact: true }),
      page.locator("xpath=//button[starts-with(normalize-space(),\"Save\")]"),
    ];

    this.statusResultLocatorCandidates = [
      page.getByText("Password Not Set", { exact: false }),
      page.getByText("Password Not Set", { exact: true }),
      page.locator("xpath=//*[normalize-space()=\"Password Not Set\"]"),
    ];
  }

  async goto(url: string): Promise<void> {
    await this.navigateTo(url);
  }

  async expectPageUrl(url: string | RegExp): Promise<void> {
    await expect(this.page).toHaveURL(url);
  }

  async clickUserManagementNavigation(): Promise<void> {
    const locator = await this.firstVisibleLocator("User Management navigation", this.userManagementNavigationLocatorCandidates);
    await locator.click();
  }

  async clickAddUserButton(): Promise<void> {
    const locator = await this.firstVisibleLocator("Add User button", this.addUserButtonLocatorCandidates);
    await locator.click();
  }

  async clickAddInternalUser(): Promise<void> {
    const locator = await this.firstVisibleLocator("Add Internal User", this.addInternalUserLocatorCandidates);
    await locator.click();
  }

  async fillFirstNameInput(value: string): Promise<void> {
    const locator = await this.firstVisibleLocator("First Name input", this.firstNameInputLocatorCandidates);
    await locator.fill(value);
  }

  async fillLastNameInput(value: string): Promise<void> {
    const locator = await this.firstVisibleLocator("Last Name input", this.lastNameInputLocatorCandidates);
    await locator.fill(value);
  }

  async fillEmailAddressInput(value: string): Promise<void> {
    const locator = await this.firstVisibleLocator("Email Address input", this.emailAddressInputLocatorCandidates);
    await locator.fill(value);
  }

  async selectRoleDropdown(value: string): Promise<void> {
    const locator = await this.firstVisibleLocator("Role dropdown", this.roleDropdownLocatorCandidates);
    const tagName = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "");
    if (tagName === "select") {
      await locator.selectOption(value);
      return;
    }
    await locator.click();
    await this.clickVisibleDropdownOption(value);
  }

  async clickSaveButton(): Promise<void> {
    const locator = await this.firstVisibleLocator("Save button", this.saveButtonLocatorCandidates);
    await locator.click();
  }

  async expectStatusResultText(expectedText: string | RegExp): Promise<void> {
    const locator = await this.firstVisibleLocator("status result", this.statusResultLocatorCandidates);
    await expect(locator).toContainText(expectedText);
  }
}
