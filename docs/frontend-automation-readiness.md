# Frontend Automation Readiness Handoff

## Purpose

This document explains what the frontend team should improve so our Playwright automation framework can generate, run, heal, and report tests reliably.

It is based on:

- The existing frontend engineering standards document: `Frontend Engineering Standards for Automation-Friendly Applications.pdf`
- The current automation framework behavior in this repository
- The latest dynamic and static generation results for User Management test cases

## Current Automation Status

The framework currently processes 5 User Management scenarios independently.

Latest generation result:

| Scenario | Status | Reason |
| --- | --- | --- |
| `TC-UM-001` | Generated | Dynamic recon produced usable locators |
| `TC-UM-002` | Blocked | Missing safe locator for `Select Role` |
| `TC-UM-003` | Generated | Dynamic recon produced usable locators |
| `TC-UM-004` | Generated | Dynamic recon produced usable locators |
| `TC-UM-005` | Generated | Dynamic recon produced usable locators |

Summary:

- Total scenarios: `5`
- Generated TypeScript specs: `4`
- Blocked scenarios: `1`
- Blocked case: `TC-UM-002`
- Blocked step: `Select Role`
- Dynamic execution result: `4` passed, `1` failed, `32/33` steps passed

The framework is now designed so one blocked scenario does not stop all remaining scenarios. This is good for automation, but frontend quality still determines whether each scenario can be converted into a stable Playwright script.

## Dynamic JSON Audit Findings

The latest dynamic JSON confirms that most user flows are discoverable, but several successful steps still depend on medium-risk selectors. These should be improved before the tests are treated as stable regression tests.

| Area | Current Dynamic Evidence | Risk | Frontend Fix Needed |
| --- | --- | --- | --- |
| Add User Role dropdown | `TC-UM-001` and `TC-UM-003` passed using visible text such as `Select role` and role option text | Works now, but can break if label/value text changes | Add `data-testid`, connected label, stable role option IDs |
| Edit User Role dropdown | `TC-UM-002` failed because the combobox has no locator candidates | Current blocker | Add accessible name and test ID to edit Role combobox |
| Row actions menu | Passed using row email plus `.locator("button").nth(0)` | Fragile if more buttons are added to the row | Give the action button an `aria-label` and `data-testid` |
| Menu items | Dynamic IDs like `pr_id_393_1` are present | Dynamic IDs should not be used for automation | Add stable menu item test IDs |
| Dialogs | Dialogs have `role="dialog"`, but IDs like `pr_id_22` are dynamic | Dialog is usable, but not strongly stable | Add stable dialog title ID and `data-testid` |
| Comment field | Uses placeholder/name such as `Add comments` and `comment` | Good enough now, but placeholder-only selectors are weaker than labels/test IDs | Connect label to textarea and add `data-testid` |
| Search input | Uses placeholder `Search by name or email` | Passes now, but placeholder text may change | Add `aria-label` and `data-testid` |

Important conclusion: `4` scenarios passed dynamic execution, but that does not mean the frontend is fully automation-ready. It means the framework found enough usable selectors this time. The current frontend should still be improved to avoid flaky tests later.

## What Is Already Working Well

The frontend already exposes some elements in a way automation can use:

- User Management navigation is available through a button name.
- Search input can be found by placeholder text.
- Deactivate and Reactivate actions are visible as named links.
- Comment fields have recognizable placeholder text.
- Deactivate and Reactivate confirmation buttons have accessible names.
- Some form inputs expose stable IDs, such as `firstName`, `lastName`, and `email`.
- Table rows contain enough user text for the automation to find a row by email in some flows.

These are good signs. They allow dynamic recon to generate Playwright locators for 4 out of 5 scenarios.

However, several of these are not the strongest possible selectors. Text-only locators, placeholder locators, dynamic generated IDs, and `nth(0)` row buttons are acceptable for temporary discovery, but they should not be the final frontend contract.

## Main Blocker Found

`TC-UM-002` is blocked because the Role control is visible to the user but not stable enough for automation.

From the dynamic DOM snapshot:

- The visible label exists: `Role *`
- The actual control is an `input` with `role="combobox"`
- The combobox does not expose a stable label, placeholder, `aria-label`, `data-testid`, or safe CSS candidate
- The label is not programmatically connected to the combobox
- The current Role value is visible as `QA TEST MAGT`, but the control itself has no stable machine-readable identity

Because of this, the automation framework cannot safely select the Role dropdown without guessing. Guessing would create flaky or incorrect tests, so the framework blocks the scenario instead.

## Why This Matters

Automation does not only need visible UI. It needs stable, machine-readable UI.

Good automation-friendly frontend code helps us:

- Generate Playwright scripts from test cases
- Reduce dependency on LLM guessing
- Avoid flaky selectors like `nth-child`, dynamic classes, or layout-based XPath
- Run tests reliably in CI
- Heal failed tests with better evidence
- Report real failures instead of selector problems
- Keep tests stable when styling or layout changes

If frontend elements are not accessible or stable, automation has to guess. That increases false failures, maintenance cost, and execution time.

## Required Improvements

| Priority | Area | Required Improvement | Reason |
| --- | --- | --- | --- |
| P0 | Critical controls | Add stable `data-testid` to all important buttons, inputs, dropdowns, rows, menus, dialogs, and confirmation actions | Gives automation a reliable fallback locator |
| P0 | Role dropdown | Add accessible name, stable ID, and `data-testid` to the Role combobox | Fixes the current `TC-UM-002` blocker |
| P0 | Edit form controls | Ensure Add and Edit forms use the same accessible component contract | Prevents one form from passing while another form fails |
| P0 | Labels | Connect every visible label to its control using `for`/`id` or `aria-labelledby` | Allows Playwright `getByLabel()` and accessibility-based locators |
| P1 | Tables | Add stable row identifiers and action menu labels | Avoids fragile row/index selectors |
| P1 | Dialogs and drawers | Add `role="dialog"`, accessible title, and stable test IDs | Makes modal workflows reliable |
| P1 | Menus | Add stable IDs/test IDs and accessible labels for menu, menu button, and menu items | Avoids generated IDs like `pr_id_*` and text-only matching |
| P1 | Loading/error states | Add explicit loading, empty, and error states with roles and test IDs | Helps automation wait correctly |
| P1 | Custom components | Ensure custom selects, menus, tabs, and dialogs expose correct ARIA roles | Makes non-native components automation-friendly |
| P2 | DOM stability | Avoid unnecessary remounting, dynamic wrappers, and index-based rendering keys | Prevents locator drift after UI changes |
| P2 | CSS classes | Do not use styling classes as automation hooks | CSS changes should not break tests |

## Required Test ID Naming Convention

Use stable, readable names. Recommended pattern:

```text
feature-entity-element-action
```

Examples for User Management:

| Element | Recommended `data-testid` |
| --- | --- |
| User Management nav | `user-management-nav` |
| Search input | `user-search-input` |
| Add User button | `user-add-button` |
| Internal User option | `user-add-internal-option` |
| First name input | `user-first-name-input` |
| Last name input | `user-last-name-input` |
| Email input | `user-email-input` |
| Role combobox | `user-role-combobox` |
| Role option | `user-role-option-workflow-operators` |
| Save button | `user-save-button` |
| User row | `user-row` |
| Row action menu | `user-actions-menu` |
| Deactivate menu item | `user-deactivate-option` |
| Reactivate menu item | `user-reactivate-option` |
| Deactivate dialog | `deactivate-user-dialog` |
| Deactivate comment input | `deactivate-comment-input` |
| Deactivate confirm button | `deactivate-confirm-button` |
| Reactivate dialog | `reactivate-user-dialog` |
| Reactivate comment input | `reactivate-comment-input` |
| Reactivate confirm button | `reactivate-confirm-button` |

## Concrete Frontend Fixes

### Role Dropdown

Current problem:

```html
<label>Role *</label>
<input type="text" role="combobox" />
```

The label is visible, but automation cannot prove that the label belongs to this combobox.

This must be fixed in both Add User and Edit User forms. The current Add User flow passed, but the Edit User flow failed because the selected value state did not expose the same safe locator evidence.

Recommended implementation:

```html
<label id="user-role-label" for="user-role-combobox">
  Role
</label>

<input
  id="user-role-combobox"
  name="role"
  role="combobox"
  aria-labelledby="user-role-label"
  aria-expanded="false"
  aria-controls="user-role-listbox"
  data-testid="user-role-combobox"
/>

<ul
  id="user-role-listbox"
  role="listbox"
  data-testid="user-role-options"
>
  <li
    role="option"
    data-testid="user-role-option-workflow-operators"
  >
    Workflow Operators
  </li>
</ul>
```

If the dropdown is implemented as a button-based custom select:

```html
<button
  type="button"
  role="combobox"
  aria-label="Role"
  aria-expanded="false"
  aria-controls="user-role-listbox"
  data-testid="user-role-combobox"
>
  Select role
</button>
```

### User Table Rows

Recommended implementation:

```html
<tr
  data-testid="user-row"
  data-row-id="sanjeevkumar.m00@gmail.com"
>
  <td data-testid="user-name-cell">Sanjeev Kumar</td>
  <td data-testid="user-email-cell">sanjeevkumar.m00@gmail.com</td>
  <td data-testid="user-status-cell">Active</td>
  <td>
    <button
      type="button"
      aria-label="Actions for sanjeevkumar.m00@gmail.com"
      data-testid="user-actions-menu"
    >
      Actions
    </button>
  </td>
</tr>
```

Avoid requiring automation to use this pattern:

```ts
page.getByRole("row", { name: /user@example.com/i }).locator("button").nth(0)
```

That works only while the action button remains the first button in the row. A stable action button name is safer.

### Action Menus

Recommended implementation:

```html
<button
  type="button"
  aria-haspopup="menu"
  aria-expanded="false"
  aria-label="Actions for sanjeevkumar.m00@gmail.com"
  data-testid="user-actions-menu"
>
  Actions
</button>

<ul
  role="menu"
  aria-label="User actions"
  data-testid="user-actions-menu-list"
>
  <li role="none">
    <button
      type="button"
      role="menuitem"
      data-testid="user-edit-option"
    >
      Edit
    </button>
  </li>
  <li role="none">
    <button
      type="button"
      role="menuitem"
      data-testid="user-deactivate-option"
    >
      Deactivate
    </button>
  </li>
</ul>
```

Do not depend on generated menu IDs such as `pr_id_393_1`. They may change between renders, sessions, or builds.

### Search Input

Recommended implementation:

```html
<label for="user-search-input">Search users</label>
<input
  id="user-search-input"
  name="userSearch"
  type="search"
  aria-label="Search users by name or email"
  placeholder="Search by name or email"
  data-testid="user-search-input"
/>
```

### Dialogs

Recommended implementation:

```html
<section
  role="dialog"
  aria-modal="true"
  aria-labelledby="deactivate-user-title"
  data-testid="deactivate-user-dialog"
>
  <h2 id="deactivate-user-title">Deactivate User</h2>

  <label for="deactivate-comment-input">Add comments</label>
  <textarea
    id="deactivate-comment-input"
    name="comments"
    data-testid="deactivate-comment-input"
  ></textarea>

  <button
    type="button"
    data-testid="deactivate-confirm-button"
  >
    Deactivate
  </button>
</section>
```

The current dynamic JSON already shows `role="dialog"` for deactivate/reactivate dialogs. The improvement needed is to replace dynamic IDs such as `pr_id_22` with stable test IDs and a stable title relationship.

## Locator Priority Expected By Automation

The automation framework should be able to use locators in this order:

1. Accessibility locator, such as `getByRole()` or `getByLabel()`
2. Stable `data-testid`
3. Stable ID
4. Stable visible text
5. Stable CSS selector
6. XPath only as a last resort

The frontend should support the first two options wherever possible.

## Acceptance Criteria For Frontend Team

Before a page is considered automation-ready:

- Every important interactive element has an accessible name.
- Every form field has a visible label connected to the control.
- Every critical element has a stable `data-testid`.
- Every custom dropdown exposes `role="combobox"`, `aria-expanded`, and stable option locators.
- Add and Edit forms use the same locator/accessibility contract for shared fields.
- Every table row exposes stable row identity.
- Every row action menu has an accessible label that includes the row identity.
- Every menu item has a stable `data-testid` and does not rely on generated IDs.
- Every dialog has `role="dialog"`, `aria-modal`, and an accessible title.
- Loading states use `role="status"` or a stable `data-testid`.
- Error messages use `role="alert"` or are linked with `aria-describedby`.
- Dynamic IDs, generated CSS classes, and DOM index selectors are not required for automation.

## Expected Result After Improvements

After fixing the Role dropdown and adding stable frontend hooks:

- `TC-UM-002` should no longer be blocked at `Select Role`.
- Dynamic recon should produce safe locators for all 5 scenarios.
- Static generation should generate all 5 TypeScript specs.
- Playwright execution should run all generated specs independently.
- Final reports should show real functional failures, not selector/discovery failures.

## Suggested Rollout Plan

1. Fix the Role dropdown first because it is the current blocker.
2. Add `data-testid` and accessible labels across the User Management page.
3. Update shared component library components so all future screens inherit the same automation-friendly behavior.
4. Add frontend review checks for labels, ARIA roles, stable IDs, and test IDs.
5. Re-run dynamic recon and static generation after each rollout phase.

## Commands For Automation Re-Test

From the project root:

```bash
npm run run:webwright
npm run generate
npm run validate
npx playwright test tests/generated --list
```

Run generated tests only when the target environment is ready for business actions:

```bash
npm run run:generated
```

For the current state, `npm run generate` should create specs for `TC-UM-001`, `TC-UM-003`, `TC-UM-004`, and `TC-UM-005`, while `TC-UM-002` remains blocked until the Role dropdown is fixed.
