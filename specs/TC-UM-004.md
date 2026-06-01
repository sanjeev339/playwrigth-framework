# Test Plan: TC-UM-004

## Module: User Management

## Test Case Title: Deactivate an Existing User

## Preconditions

*   The system under test is accessible.
*   An administrator user is logged in with appropriate permissions to manage users.
    *   **Login Credentials:** `process.env.ADMIN_USERNAME`, `process.env.ADMIN_PASSWORD`
*   A user with the following details exists in the system and is currently in an 'Active' state. This user is assumed to have been created in a preceding test case (e.g., `TC-UM-001`).

## Test Data

*   **First Name:** `adithya`
*   **Last Name:** `j`
*   **Full Name:** `adithya j`
*   **Email Address:** `sanjeevkumar.m00@gmail.com`
*   **Expected Status After Deactivation:** `Deactivated`

## Test Steps

### Step 1: Navigate to User Management

1.  **Action:** Ensure the administrator user is logged in.
2.  **Action:** Navigate to the "User Management" section of the application, typically via a main navigation menu or a direct URL.

    *   **Expected Outcome:** The User Management page is displayed, showing a list or table of users.
    *   **Assertions:**
        *   **Must:** The current URL contains a path segment like `/user-management` or `/admin/users`.
        *   **Must:** A prominent page title or heading, such as "User Management", "Manage Users", or "Users List", is visible.

### Step 2: Select the User to Deactivate

1.  **Action:** On the User Management page, locate the user with the email address `sanjeevkumar.m00@gmail.com`. This may involve using a search bar, applying filters, or navigating through pagination.
2.  **Action:** Click on the identified user's row, name, or an associated "View Details" / "Edit" action to open their individual user profile or details page.

    *   **Expected Outcome:** The selected user's details page is displayed.
    *   **Assertions:**
        *   **Must:** The user's `Full Name` (`adithya j`) is clearly visible on the page.
        *   **Must:** The user's `Email Address` (`sanjeevkumar.m00@gmail.com`) is clearly visible.
        *   **Must:** The user's current `Status` is displayed as "Active".
        *   **Note:** Recon needed to identify the exact locator for the user row/card in the list and the specific action (e.g., click row, click icon) to navigate to the user's details.

### Step 3: Click on Deactivate

1.  **Action:** On the user details page, locate and click the "Deactivate" button or similar control (e.g., "Change Status", "Disable User").
2.  **Action:** If a confirmation dialog or modal appears (e.g., "Are you sure you want to deactivate this user?", "Confirm Deactivation"), click the affirmative button (e.g., "Deactivate", "Confirm", "Yes").

    *   **Expected Outcome:** The user's status is updated to "Deactivated", and the change is reflected in the UI.
    *   **Assertions:**
        *   **Optional (if visible):** A success toast, snackbar, or brief banner message appears, e.g., "User 'adithya j' has been deactivated successfully."
        *   **Must:** The user's `Status` displayed on the page (or upon returning to the User Management list and refreshing) changes to "Deactivated".
        *   **Note:** Recon needed to identify the exact locator for the "Deactivate" button and any elements within a confirmation dialog.

## Post-conditions / Overall Verification

1.  **Action:** Log out as the administrator user.
2.  **Action:** Attempt to log in to the application using the credentials of the now-deactivated user (`sanjeevkumar.m00@gmail.com`).
    *   **Login Credentials:** `sanjeevkumar.m00@gmail.com`, `process.env.DEACTIVATED_USER_PASSWORD` (assuming a password was set for this user prior to deactivation).

    *   **Expected Outcome:** The login attempt fails, and the deactivated user is unable to access the application.
    *   **Assertions:**
        *   **Must:** An error message is displayed on the login page, indicating that the user is deactivated, inactive, or that the credentials are invalid (if the system treats deactivated users this way).
        *   **Must:** The browser is not redirected to the application's dashboard, home page, or any authenticated section.
