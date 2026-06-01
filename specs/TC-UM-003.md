# Playwright Test Plan: TC-UM-003

## Module: User Management

## Test Case Title: Update an existing user's role in User Management

## Preconditions:

*   User is logged in as an administrator (or a user with sufficient permissions to manage user roles).
*   A user with the email `sanjeevkumar.m00@gmail.com` exists in the system.
*   The role "Workflow Operators" is available and selectable in the system.

## Test Environment Credentials:

*   `process.env.USERNAME`
*   `process.env.PASSWORD`

## Step-by-step Business Flow & Assertions:

### 1. Login to the application.

*   **Action:** Navigate to the application login page.
*   **Action:** Enter `process.env.USERNAME` into the username input field.
*   **Action:** Enter `process.env.PASSWORD` into the password input field.
*   **Action:** Click the "Login" button.
*   **Assertion:**
    *   Must: Be redirected to the application dashboard or home page.
    *   Must: Page URL contains `/dashboard` (or similar route for the main application landing page).
    *   Must: Page title or main heading is "Dashboard" (or similar).

### 2. Navigate to User Management.

*   **Action:** Click on the "User Management" navigation link or menu item.
*   **Assertion:**
    *   Must: Page URL contains `/user-management` (or similar route).
    *   Must: Page title or main heading is "User Management" (or similar).
    *   Must: A list or table displaying users is visible.

### 3. Select the target user for editing.

*   **Action:** Locate the user `sanjeevkumar.m00@gmail.com` in the user list/table.
*   **Action:** Click on the row, link, or "View/Details" button associated with `sanjeevkumar.m00@gmail.com`.
*   **Assertion:**
    *   Must: Be redirected to a user details page or a user details modal appears.
    *   Must: If a dedicated page, URL contains `/user-management/sanjeevkumar.m00@gmail.com` (or a user ID).
    *   Must: Page title or main heading is "User Details" or "View User" (or similar).
    *   Must: The displayed email address on the details view is `sanjeevkumar.m00@gmail.com`.

### 4. Initiate the edit process.

*   **Action:** Click the "Edit" button on the user details page or within the user details modal.
*   **Assertion:**
    *   Must: An "Edit User" form or modal is displayed.
    *   Must: The "Role" dropdown/select element is visible and enabled.

### 5. Select the new role.

*   **Action:** Select "Workflow Operators" from the "Role" dropdown.
*   **Assertion:**
    *   Must: The "Role" dropdown now displays "Workflow Operators" as the selected value.

### 6. Save the changes.

*   **Action:** Click the "Save" button.
*   **Assertion:**
    *   Optional (if visible): A success toast, snackbar, or banner appears with text like "User role updated successfully" or "Changes saved."
    *   Must: Be redirected back to the user details page or the main user management list.
    *   Must: The displayed role for `sanjeevkumar.m00@gmail.com` is "Workflow Operators" (either on the user details page or in the user list).
    *   Must: If redirected to the user list, the row for `sanjeevkumar.m00@gmail.com` explicitly shows "Workflow Operators" as the assigned role.

## Notes for Dynamic UI States / Reconnaissance:

*   **Navigation to User Management:** The exact selector for the "User Management" navigation link (e.g., sidebar, top menu, dropdown) needs to be identified.
*   **User Selection:** Confirm how to select the user `sanjeevkumar.m00@gmail.com`. Is it by clicking the user's email text, a specific row, or an action button next to the user?
*   **Edit Button:** The precise selector for the "Edit" button on the user details view needs to be determined.
*   **Role Dropdown:** The selector for the "Role" dropdown and the method to select an option (e.g., `selectOption` by value, label, or index) should be confirmed.
*   **Save Button:** The selector for the "Save" button needs to be identified.
*   **Success Message:** If a success toast/snackbar is present, its selector and expected text content should be noted for optional assertion. These elements often auto-dismiss, so a `page.waitForSelector` with `state: 'hidden'` might be useful after checking visibility.
*   **Role Reflection:** Verify where the updated role is displayed after saving: is it immediately visible on the user details page, or does the test need to navigate back to the user list to confirm? The selector for the role display element in either location is crucial.
