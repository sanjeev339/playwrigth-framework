import { Page, Locator } from '@playwright/test';
import { BasePage } from '../../core/base/BasePage';

/**
 * UserManagementPage
 * URL  : https://adminportal.dev.eigen-dyne.com/users/internal-user
 * Recon: Phase B live DOM inspection — 2026-05-22
 * User : sanjeevkumarm@piraiinfo.com (dev environment)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * HYBRID LOCATOR STRATEGY — priority order for resilience:
 *   1. ID            (#firstName, #lastName, #email)
 *   2. name attr     (input[name="..."])
 *   3. Accessibility (getByRole / aria-label / aria-labelledby)
 *   4. CSS class     (.p-multiselect, .p-menuitem)
 *   5. XPath         (//xpath/expression)
 *
 * Each locator property below lists ALL discovered fallbacks as structured
 * comments so that reruns can swap strategies when the DOM changes.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ⚠  Live-behaviour notes (verified 2026-05-22):
 *    1. Role "Executive" from spec does NOT exist in dropdown.
 *       Available: "Workflow Operators", "Workflow Designer (Orchestrator Author)", etc.
 *    2. Edit User sidebar: Role field is DISABLED — role cannot be changed via this form.
 *    3. New user status = "Password Not Set" (spec says "Pending").
 */
export class UserManagementPage extends BasePage {

  // ── Sidebar navigation ─────────────────────────────────────────────────────
  /**
   * User Management nav button (left sidebar)
   * Locators (in priority order):
   *   P3 [Accessibility] : page.getByRole('button', { name: 'User Management' })  ✅ PRIMARY
   *   P4 [CSS]           : button:has(img) — not specific enough
   *   P5 [XPath]         : //button[normalize-space()='User Management']
   */
  readonly userManagementNavButton: Locator;

  // ── Page header ────────────────────────────────────────────────────────────
  /**
   * "Internal Users" h1 heading
   * P3 [Accessibility] : page.getByRole('heading', { name: 'Internal Users', level: 1 })  ✅ PRIMARY
   * P4 [CSS]           : main h1
   * P5 [XPath]         : //h1[normalize-space()='Internal Users']
   */
  readonly pageHeading: Locator;

  // ── Toolbar ────────────────────────────────────────────────────────────────
  /**
   * "+ Add User" button
   * P3 [Accessibility] : page.getByRole('button', { name: /Add User/ })  ✅ PRIMARY
   * P4 [CSS]           : button.center-loader-btn (class may change)
   * P5 [XPath]         : //button[contains(.,'Add User')]
   */
  readonly addUserButton: Locator;

  /**
   * Search box (name/email filter)
   * P3 [Accessibility] : page.getByRole('searchbox', { name: 'Search by name or email' })  ✅ PRIMARY
   * P4 [CSS]           : input[placeholder="Search by name or email"]
   * P5 [XPath]         : //input[@placeholder="Search by name or email"]
   */
  readonly searchInput: Locator;

  // ── Onboarding dialog ──────────────────────────────────────────────────────
  /**
   * "Select your Onboarding option" modal dialog
   * P3 [Accessibility] : page.getByRole('dialog')  ✅ PRIMARY
   * P4 [CSS]           : [role="dialog"]
   * P5 [XPath]         : //*[@role='dialog']
   */
  readonly onboardingDialog: Locator;

  /**
   * "Add Internal User" card inside the onboarding dialog
   * P3 [Accessibility] : dialog >> getByText('Add Internal User')  ✅ PRIMARY
   * P4 [CSS]           : [role="dialog"] div:nth-child(1) (inside options container)
   * P5 [XPath]         : //*[@role='dialog']//*[normalize-space()='Add Internal User']
   * Note: card is a plain <div> — no role/id; text match is most stable
   */
  readonly addInternalUserCard: Locator;

  // ── Add/Edit User sidebar (role="complementary") ───────────────────────────
  /**
   * Sidebar drawer wrapper
   * P3 [Accessibility] : page.locator('[role="complementary"]')  ✅ PRIMARY
   * P4 [CSS]           : .p-drawer (PrimeVue component)
   * P5 [XPath]         : //*[@role='complementary']
   */
  readonly sidebar: Locator;

  /**
   * First Name input
   * P1 [ID]            : #firstName (id="firstName")  ✅ PRIMARY — highest priority
   * P3 [Accessibility] : sidebar >> getByRole('textbox', { name: 'Enter first name' })
   * P4 [CSS]           : [role="complementary"] input[placeholder="Enter first name"]
   * P5 [XPath]         : //*[@role='complementary']//input[@id='firstName']
   * Field constraints  : type=text, required=true (label shows *)
   */
  readonly firstNameInput: Locator;

  /**
   * Last Name input
   * P1 [ID]            : #lastName (id="lastName")  ✅ PRIMARY
   * P3 [Accessibility] : sidebar >> getByRole('textbox', { name: 'Enter last name' })
   * P4 [CSS]           : [role="complementary"] input[placeholder="Enter last name"]
   * P5 [XPath]         : //*[@role='complementary']//input[@id='lastName']
   * Field constraints  : type=text, required=true
   */
  readonly lastNameInput: Locator;

  /**
   * Email input — scoped to sidebar to avoid clash with login page #email
   * P1 [ID scoped]     : [role="complementary"] #email  ✅ PRIMARY
   * P3 [Accessibility] : sidebar >> getByRole('textbox', { name: 'Enter email address' })
   * P4 [CSS]           : [role="complementary"] input[type="email"]
   * P5 [XPath]         : //*[@role='complementary']//input[@id='email']
   * Field constraints  : type=email, required=true
   */
  readonly emailInput: Locator;

  /**
   * Role — PrimeVue MultiSelect component
   * P4 [CSS data-attr] : [role="complementary"] [data-pc-name="multiselect"]  ✅ PRIMARY
   *   (data-pc-name is a stable PrimeVue component identifier)
   * P4 [CSS class]     : [role="complementary"] .p-multiselect
   * P5 [XPath]         : //*[@role='complementary']//*[@data-pc-name='multiselect']
   * Interaction note   : Click [data-pc-section="labelcontainer"] to open panel.
   *   The hidden input[role="combobox"] inside cannot be clicked directly (blocked by label div).
   */
  readonly roleMultiselect: Locator;

  /**
   * Role dropdown panel (appears after opening multiselect)
   * P4 [CSS class]     : .p-multiselect-panel  ✅ PRIMARY
   * P5 [XPath]         : //*[contains(@class,'p-multiselect-panel')]
   */
  readonly roleDropdownPanel: Locator;

  /**
   * Save button (in sidebar footer)
   * P3 [Accessibility] : sidebar >> getByRole('button', { name: /Save/i })  ✅ PRIMARY
   * P4 [CSS]           : [role="complementary"] button[type="button"]:last-of-type
   * P5 [XPath]         : //*[@role='complementary']//button[contains(.,'Save')]
   */
  readonly saveButton: Locator;

  // ── User table ─────────────────────────────────────────────────────────────
  /**
   * The users data table
   * P4 [CSS]   : table  ✅ PRIMARY (only one table on the page)
   * P5 [XPath] : //table
   */
  readonly userTable: Locator;

  /**
   * All rows (header row is index 0, data rows start at 1)
   * P4 [CSS]   : table [role="row"]  ✅ PRIMARY
   * P5 [XPath] : //table//*[@role='row']
   */
  readonly tableRows: Locator;

  // ── Action menu (PrimeVue Menu — appears on 3-dot button click) ────────────
  /**
   * "Edit" menu item
   * P3 [Accessibility] : page.getByRole('menuitem', { name: 'Edit' })  ✅ PRIMARY
   * P4 [CSS]           : .p-menuitem:nth-child(1)  (positional — fragile if order changes)
   * P5 [XPath]         : //li[contains(@class,'p-menuitem')][1]
   */
  readonly editMenuItem: Locator;

  /**
   * "Deactivate" menu item
   * P3 [Accessibility] : page.getByRole('menuitem', { name: 'Deactivate' })  ✅ PRIMARY
   * P4 [CSS]           : .p-menuitem:nth-child(2)
   * P5 [XPath]         : //li[contains(@class,'p-menuitem')][2]
   */
  readonly deactivateMenuItem: Locator;

  // ── Confirmation dialog (deactivate / terminate) ───────────────────────────
  /**
   * Confirmation modal dialog
   * P3 [Accessibility] : page.getByRole('dialog')  ✅ PRIMARY
   * P4 [CSS]           : [role="dialog"].customModal  (class verified from live DOM)
   * P5 [XPath]         : //*[@role='dialog']
   */
  readonly confirmationDialog: Locator;

  /**
   * "Deactivate" confirm button inside the dialog
   * P3 [Accessibility] : dialog >> getByRole('button', { name: 'Deactivate' })  ✅ PRIMARY
   * P4 [CSS]           : [role="dialog"] button:last-of-type
   * P5 [XPath]         : //*[@role='dialog']//button[normalize-space()='Deactivate']
   */
  readonly confirmDeactivateButton: Locator;

  /**
   * "Add comments" textbox inside the deactivate dialog
   * P3 [Accessibility] : dialog >> getByRole('textbox', { name: 'Add comments' })  ✅ PRIMARY
   */
  readonly deactivateCommentInput: Locator;

  /**
   * "Cancel" button inside the dialog
   * P3 [Accessibility] : dialog >> getByRole('button', { name: 'Cancel' })  ✅ PRIMARY
   * P5 [XPath]         : //*[@role='dialog']//button[normalize-space()='Cancel']
   */
  readonly cancelDialogButton: Locator;

  // ── Toast / error messages ─────────────────────────────────────────────────
  /**
   * Success toast message element
   * P4 [CSS] : .custom-success-toast .success-message  ✅ PRIMARY
   * P4 [CSS] : [class*="toast"][class*="success"]  (fallback)
   */
  readonly successToast: Locator;

  /**
   * Inline error or error toast message
   * P4 [CSS] : .text-red-500 (Tailwind error text — verified in login form)  ✅ PRIMARY
   * P4 [CSS] : .p-error (PrimeVue validation error class)
   * P4 [CSS] : .custom-error-toast .error-message
   */
  readonly errorMessage: Locator;

  // ─────────────────────────────────────────────────────────────────────────────

  constructor(page: Page) {
    super(page);

    // Navigation
    this.userManagementNavButton = page.getByRole('button', { name: 'User Management' });

    // Page header
    this.pageHeading = page.getByRole('heading', { name: 'Internal Users', level: 1 });

    // Toolbar
    this.addUserButton      = page.getByRole('button', { name: /Add User/ });
    this.searchInput        = page.getByRole('searchbox', { name: 'Search by name or email' });

    // Onboarding dialog
    this.onboardingDialog    = page.getByRole('dialog');
    this.addInternalUserCard = page.getByRole('dialog').getByText('Add Internal User');

    // Sidebar — scope all form fields to [role="complementary"] to prevent selector collisions
    this.sidebar         = page.locator('[role="complementary"]');
    this.firstNameInput  = this.sidebar.locator('#firstName');          // P1: ID
    this.lastNameInput   = this.sidebar.locator('#lastName');           // P1: ID
    this.emailInput      = this.sidebar.locator('#email');              // P1: ID (scoped)
    this.roleMultiselect = this.sidebar.locator('[data-pc-name="multiselect"]'); // P4: data-attr
    this.roleDropdownPanel = page.locator('.p-multiselect-panel');      // P4: CSS class (global)
    this.saveButton      = this.sidebar.getByRole('button', { name: /Save/i }); // P3: accessibility

    // User table
    this.userTable  = page.locator('table');
    this.tableRows  = this.userTable.locator('[role="row"]');

    // Action menu items (PrimeVue Menu appends to body — not scoped to sidebar)
    this.editMenuItem       = page.locator('[role="menuitem"]:has-text("Edit"), .p-menuitem:has-text("Edit")');
    this.deactivateMenuItem = page.locator('[role="menuitem"]:has-text("Deactivate"), .p-menuitem:has-text("Deactivate")');

    // Confirmation dialog
    this.confirmationDialog    = page.getByRole('dialog');
    this.confirmDeactivateButton = page.getByRole('dialog')
      .getByRole('button', { name: 'Deactivate' });
    this.deactivateCommentInput = page.getByRole('dialog')
      .getByRole('textbox', { name: 'Add comments' });
    this.cancelDialogButton    = page.getByRole('dialog')
      .getByRole('button', { name: 'Cancel' });

    // Toast / error
    this.successToast = page.locator('.custom-success-toast .success-message');
    this.errorMessage = page
      .locator('.text-red-500, .p-error, .custom-error-toast .error-message')
      .first();
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  /**
   * Click "User Management" in the sidebar nav and wait for the page to load.
   */
  async navigateToUserManagement(): Promise<void> {
    await this.userManagementNavButton.click();
    await this.pageHeading.waitFor({ state: 'visible', timeout: 15_000 });
  }

  // ── Add User form ──────────────────────────────────────────────────────────

  /**
   * Click "+ Add User", wait for the onboarding dialog, then click "Add Internal User".
   * Waits for the First Name field in the sidebar to confirm the form is ready.
   */
  async openAddInternalUserForm(): Promise<void> {
    await this.addUserButton.click();
    await this.onboardingDialog.waitFor({ state: 'visible', timeout: 10_000 });
    await this.addInternalUserCard.click();
    await this.firstNameInput.waitFor({ state: 'visible', timeout: 10_000 });
  }

  /** Type into the First Name field. */
  async fillFirstName(value: string): Promise<void> {
    await this.firstNameInput.fill(value);
  }

  /** Type into the Last Name field. */
  async fillLastName(value: string): Promise<void> {
    await this.lastNameInput.fill(value);
  }

  /** Type into the Email Address field (scoped to sidebar). */
  async fillEmail(value: string): Promise<void> {
    await this.emailInput.fill(value);
  }

  /**
   * Open the Role MultiSelect, click the option matching roleName, then close the panel.
   *
   * PrimeVue MultiSelect interaction:
   *   1. Click [data-pc-section="labelcontainer"] to open the overlay panel.
   *      (The hidden input[role="combobox"] cannot be clicked — the label div blocks it.)
   *   2. Wait for .p-multiselect-panel to appear.
   *   3. Click li[role="option"] matching the role name.
   *   4. Press Escape to close the panel cleanly.
   */
  async selectRole(roleName: string): Promise<void> {
    // Open the dropdown by clicking the label container (not the hidden input)
    const labelContainer = this.roleMultiselect.locator('[data-pc-section="labelcontainer"]');
    await labelContainer.click();
    await this.roleDropdownPanel.waitFor({ state: 'visible', timeout: 8_000 });

    // Click the matching option (li[role="option"] inside the panel)
    await this.roleDropdownPanel.getByRole('option', { name: roleName, exact: true }).click();

    // Close the panel by clicking the label container again
    await labelContainer.click();
  }

  /** Click the Save button and wait for the sidebar to close or a message to appear. */
  async clickSave(): Promise<void> {
    await this.saveButton.click();
  }

  /** Close the sidebar by pressing Escape (most reliable cross-browser approach). */
  async closeSidebar(): Promise<void> {
    await this.page.keyboard.press('Escape');
  }

  // ── Table interactions ─────────────────────────────────────────────────────

  /**
   * Type a query into the search box and wait for the table to re-render.
   * Uses a short waitFor on the table rather than a fixed sleep.
   */
  async searchUser(query: string): Promise<void> {
    await this.searchInput.clear();
    await this.searchInput.fill(query);
    // Wait for the results counter to update — "Showing X of Y Results" paragraph
    await this.page.locator('p').filter({ hasText: /Showing \d+ of/ }).waitFor({
      state: 'visible',
      timeout: 8_000,
    });
  }

  /**
   * Returns the action button (3-dot menu trigger) for the row that contains email.
   * Uses CSS :has() pseudo-class to avoid hasText API.
   *
   * Selector chain:
   *   table [role="row"]:has(p:text-is("email")) button:first-child
   *
   * Fallback XPath:
   *   //table//*[@role='row'][.//p[normalize-space()='email']]//button[1]
   */
  getActionButtonForUser(email: string): Locator {
    return this.userTable
      .locator(`[role="row"]:has(p:text-is("${email}"))`)
      .locator('button')
      .first();
  }

  /**
   * Returns the Status cell locator for the row containing the given email.
   * Status is the last [role="cell"] in the row.
   */
  getStatusCellForUser(email: string): Locator {
    return this.userTable
      .locator(`[role="row"]:has(p:text-is("${email}"))`)
      .locator('[role="cell"]')
      .last();
  }

  async openEditForUser(email: string): Promise<void> {
    const actionBtn = this.getActionButtonForUser(email);
    const startTime = Date.now();
    while (Date.now() - startTime < 8000) {
      await actionBtn.click();
      try {
        await this.editMenuItem.waitFor({ state: 'visible', timeout: 1500 });
        break;
      } catch {
        // Hydration or timing gap: menu did not open, retry click
      }
    }
    await this.editMenuItem.click();
    // Wait for the sidebar heading to confirm "Edit User" drawer opened
    await this.sidebar.getByRole('heading', { level: 2 }).waitFor({
      state: 'visible',
      timeout: 8_000,
    });
  }

  /**
   * Open the 3-dot action menu for a user row and click Deactivate.
   * Waits for the confirmation dialog to appear.
   */
  async openDeactivateForUser(email: string): Promise<void> {
    const actionBtn = this.getActionButtonForUser(email);
    const startTime = Date.now();
    while (Date.now() - startTime < 8000) {
      await actionBtn.click();
      try {
        await this.deactivateMenuItem.waitFor({ state: 'visible', timeout: 1500 });
        break;
      } catch {
        // Hydration or timing gap: menu did not open, retry click
      }
    }
    await this.deactivateMenuItem.click();
    await this.confirmationDialog.waitFor({ state: 'visible', timeout: 8_000 });
  }

  /** Click the "Deactivate" button in the confirmation dialog. */
  async confirmDeactivation(comment: string = 'Deactivating user for automated testing'): Promise<void> {
    await this.deactivateCommentInput.fill(comment);
    await this.confirmDeactivateButton.click();
    // Wait for the confirmation dialog to be dismissed to ensure request completes
    await this.confirmationDialog.waitFor({ state: 'hidden', timeout: 10_000 });
  }

  /**
   * Read the status badge text for a specific user row.
   * Returns the trimmed text of the last cell in the row.
   */
  async getUserStatus(email: string): Promise<string> {
    const cell = this.getStatusCellForUser(email);
    await cell.waitFor({ state: 'visible', timeout: 10_000 });
    return (await cell.textContent())?.trim() ?? '';
  }

  async getEditFormRoleValue(): Promise<string> {
    const startTime = Date.now();
    while (Date.now() - startTime < 8000) {
      // 1. Check all comboboxes in the sidebar
      const comboboxes = this.sidebar.locator('[role="combobox"]');
      const count = await comboboxes.count();
      for (let i = 0; i < count; i++) {
        const cb = comboboxes.nth(i);
        const text = (await cb.textContent())?.trim();
        if (text && text !== '🌍' && text !== 'Select role') {
          return text;
        }
        const label = await cb.getAttribute('aria-label');
        if (label && label.trim() && label !== '🌍' && label !== 'Select role') {
          return label.trim();
        }
      }
      
      // 2. Try p-multiselect
      const multiselect = this.sidebar.locator('.p-multiselect, [data-pc-name="multiselect"]');
      if (await multiselect.first().isVisible()) {
        const text = (await multiselect.first().textContent())?.trim();
        if (text && text !== 'Select role') return text;
      }
      
      await this.page.waitForTimeout(200);
    }
    return '';
  }

  /**
   * Get the heading text from the sidebar (e.g. "Add User" or "Edit User").
   */
  async getSidebarHeading(): Promise<string> {
    const heading = this.sidebar.getByRole('heading', { level: 2 });
    return (await heading.textContent())?.trim() ?? '';
  }

  /**
   * Read the visible error or success message after a form submission.
   * Tries inline validation error first, then falls back to toast.
   */
  async getVisibleMessage(): Promise<string> {
    const locators = [
      this.page.locator('.text-red-500, .p-error, .custom-error-toast .error-message'),
      this.page.locator('button[aria-label="Close notification"] ~ div'),
      this.page.locator('[role="alert"]'),
      this.page.locator('.p-toast-message-content')
    ];

    const startTime = Date.now();
    const timeout = 6000;
    while (Date.now() - startTime < timeout) {
      for (const locator of locators) {
        const count = await locator.count();
        for (let i = 0; i < count; i++) {
          const el = locator.nth(i);
          if (await el.isVisible()) {
            const text = (await el.textContent())?.trim() ?? '';
            // Ignore the persistent "Login successful" or "Success" toast
            if (text && !text.includes('Login successful') && !text.includes('Success')) {
              return text;
            }
          }
        }
      }
      await this.page.waitForTimeout(200);
    }

    // Fallback: return the first visible element's text if any exists
    for (const locator of locators) {
      if (await locator.first().isVisible()) {
        const text = (await locator.first().textContent())?.trim() ?? '';
        if (text) return text;
      }
    }
    return '';
  }

  /**
   * If the user's status is 'Suspended', reactivate them to make subsequent tests repeatable.
   */
  async ensureUserActive(email: string): Promise<void> {
    const status = await this.getUserStatus(email);
    if (status === 'Active' || status === 'Password Not Set' || status === 'Pending') {
      return;
    }

    const actionBtn = this.getActionButtonForUser(email);
    await actionBtn.click();

    const reactivateItem = this.page.locator('[role="menuitem"]:has-text("Reactivate"), .p-menuitem:has-text("Reactivate")');
    await reactivateItem.waitFor({ state: 'visible', timeout: 5000 });
    await reactivateItem.click();

    // Check if a confirmation dialog opens
    const dialog = this.page.getByRole('dialog');
    const dialogVisible = await dialog.isVisible({ timeout: 2000 }).catch(() => false);
    if (dialogVisible) {
      const confirmBtn = dialog.getByRole('button', { name: /Reactivate|Confirm|Yes/i });
      if (await confirmBtn.isVisible()) {
        await confirmBtn.click();
      } else {
        await dialog.getByRole('button').last().click();
      }
      await dialog.waitFor({ state: 'hidden', timeout: 8000 });
    }

    // Wait for the status badge in the table to be updated to Active
    await this.page.waitForFunction(
      (emailAddr) => {
        const rows = Array.from(document.querySelectorAll('table tr, table [role="row"]'));
        const row = rows.find(r => r.textContent?.includes(emailAddr));
        if (!row) return false;
        const cells = Array.from(row.querySelectorAll('td, [role="cell"]'));
        if (cells.length === 0) return false;
        const statusText = cells[cells.length - 1].textContent?.trim();
        return statusText === 'Active' || statusText === 'Password Not Set' || statusText === 'Pending';
      },
      email,
      { timeout: 10000 }
    );
  }
}
