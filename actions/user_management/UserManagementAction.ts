import { test } from '@playwright/test';
import { UserManagementPage } from '../../page_objects/user_management/UserManagementPage';
import { Logger } from '../../core/logger/Logger';
import {
  CreateUserPayload,
  DuplicateEmailPayload,
} from '../../test-data/user_management/user-management.data';

/**
 * UserManagementAction
 *
 * Business workflows for the User Management module.
 * Each public method maps to one complete user-facing workflow.
 *
 * Rules:
 *  - NO raw locators here — all interactions go through UserManagementPage.
 *  - NO assertions here — those belong in the test spec.
 *  - Every multi-step method is wrapped in test.step() for reporting.
 */
export class UserManagementAction {
  private readonly umPage: UserManagementPage;

  constructor(umPage: UserManagementPage) {
    this.umPage = umPage;
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  /**
   * Navigate to User Management via the sidebar nav button.
   * Waits for the "Internal Users" page heading to confirm load.
   */
  async navigateToUserManagement(): Promise<void> {
    await test.step('Navigate to User Management', async () => {
      Logger.info('Navigating to User Management module');
      await this.umPage.navigateToUserManagement();
    });
  }

  // ── TC-UM-001 ───────────────────────────────────────────────────────────────

  /**
   * Create a new internal user by filling the Add User sidebar form.
   * TC-UM-001: Positive — valid user creation
   *
   * Steps:
   *   1. Click "+ Add User"
   *   2. Select "Add Internal User" in the onboarding dialog
   *   3. Fill First Name, Last Name, Email, Role
   *   4. Click Save
   */
  async createInternalUser(data: CreateUserPayload): Promise<void> {
    await test.step('TC-UM-001 Step 1 — Open Add Internal User form', async () => {
      Logger.info('Opening Add Internal User form');
      await this.umPage.openAddInternalUserForm();
    });

    await test.step('TC-UM-001 Step 2 — Fill First Name and Last Name', async () => {
      Logger.info(`Filling: firstName="${data.firstName}" lastName="${data.lastName}"`);
      await this.umPage.fillFirstName(data.firstName);
      await this.umPage.fillLastName(data.lastName);
    });

    await test.step('TC-UM-001 Step 3 — Fill Email Address', async () => {
      Logger.info(`Filling email: ${data.emailAddress}`);
      await this.umPage.fillEmail(data.emailAddress);
    });

    await test.step('TC-UM-001 Step 4 — Select Role', async () => {
      Logger.info(`Selecting role: ${data.role}`);
      await this.umPage.selectRole(data.role);
    });

    await test.step('TC-UM-001 Step 5 — Click Save', async () => {
      Logger.info('Submitting Add User form');
      await this.umPage.clickSave();
    });
  }

  // ── TC-UM-002 ───────────────────────────────────────────────────────────────

  /**
   * Attempt to create a user with an email that already exists in the system.
   * TC-UM-002: Negative — duplicate email constraint
   *
   * Does NOT verify the error — that assertion lives in the spec.
   */
  async attemptCreateWithDuplicateEmail(data: DuplicateEmailPayload): Promise<void> {
    await test.step('TC-UM-002 Step 1 — Open Add Internal User form', async () => {
      Logger.info('Opening Add Internal User form for duplicate email test');
      await this.umPage.openAddInternalUserForm();
    });

    await test.step('TC-UM-002 Step 2 — Fill details with duplicate email', async () => {
      Logger.info(`Filling duplicate email: ${data.emailAddress}`);
      await this.umPage.fillFirstName(data.firstName);
      await this.umPage.fillLastName(data.lastName);
      await this.umPage.fillEmail(data.emailAddress);
      // Select a role to pass front-end validation
      await this.umPage.selectRole('Workflow Operators');
    });

    await test.step('TC-UM-002 Step 3 — Submit form (expect error)', async () => {
      Logger.info('Submitting form — expecting duplicate email error');
      await this.umPage.clickSave();
    });
  }

  // ── TC-UM-003 ───────────────────────────────────────────────────────────────

  /**
   * Open the Edit User form for a user identified by email.
   * TC-UM-003: Role assignment — verifies edit form opens and role is visible.
   *
   * ⚠ Live-behaviour note (2026-05-22):
   *   Spec says: select role from Role dropdown and save.
   *   Reality   : Role dropdown is DISABLED in the Edit User form.
   *   This action opens the Edit form; the spec asserts role visibility only.
   */
  async openEditUserForm(targetEmail: string): Promise<void> {
    await test.step('TC-UM-003 Step 1 — Search for target user', async () => {
      Logger.info(`Searching for user: ${targetEmail}`);
      await this.umPage.searchUser(targetEmail);
    });

    await test.step('TC-UM-003 Step 1.5 — Ensure user is Active', async () => {
      Logger.info(`Ensuring user ${targetEmail} is Active`);
      await this.umPage.ensureUserActive(targetEmail);
    });

    await test.step('TC-UM-003 Step 2 — Open Edit form', async () => {
      Logger.info(`Opening Edit form for: ${targetEmail}`);
      await this.umPage.openEditForUser(targetEmail);
    });
  }

  /**
   * Read the role value shown in the (disabled) role field of the Edit User sidebar.
   * Returns the role name string for assertion in the spec.
   */
  async getEditFormRole(): Promise<string> {
    let role = '';
    await test.step('Read role value from Edit User form', async () => {
      role = await this.umPage.getEditFormRoleValue();
      Logger.info(`Role field value in Edit form: "${role}"`);
    });
    return role;
  }

  /**
   * Read the sidebar heading to confirm which drawer is open.
   */
  async getSidebarHeading(): Promise<string> {
    return this.umPage.getSidebarHeading();
  }

  // ── TC-UM-004 ───────────────────────────────────────────────────────────────

  /**
   * Deactivate a user and confirm via the confirmation dialog.
   * TC-UM-004: Verify deactivation
   *
   * Steps:
   *   1. Search for the user
   *   2. Open action menu → click Deactivate
   *   3. Confirm in the modal dialog
   */
  async deactivateUser(targetEmail: string): Promise<void> {
    await test.step('TC-UM-004 Step 1 — Search for target user', async () => {
      Logger.info(`Searching for user to deactivate: ${targetEmail}`);
      await this.umPage.searchUser(targetEmail);
    });

    await test.step('TC-UM-004 Step 1.5 — Ensure user is Active', async () => {
      Logger.info(`Ensuring user ${targetEmail} is Active`);
      await this.umPage.ensureUserActive(targetEmail);
    });

    await test.step('TC-UM-004 Step 2 — Open Deactivate dialog', async () => {
      Logger.info(`Opening deactivate confirmation for: ${targetEmail}`);
      await this.umPage.openDeactivateForUser(targetEmail);
    });

    await test.step('TC-UM-004 Step 3 — Confirm deactivation', async () => {
      Logger.info('Confirming deactivation in modal dialog');
      await this.umPage.confirmDeactivation();
    });
  }

  // ── Shared verification helpers ────────────────────────────────────────────

  /**
   * Search for a user by email and return their current status badge text.
   * Used after create / deactivate operations to confirm state.
   */
  async getUserStatusFromTable(email: string): Promise<string> {
    let status = '';
    await test.step(`Read status for user: ${email}`, async () => {
      await this.umPage.searchUser(email);
      status = await this.umPage.getUserStatus(email);
      Logger.info(`Status for "${email}": "${status}"`);
    });
    return status;
  }

  /**
   * Return the visible error or success message after a form submit.
   * Combines inline validation errors and toast messages into a single call.
   */
  async getFormResponseMessage(): Promise<string> {
    return this.umPage.getVisibleMessage();
  }
}
