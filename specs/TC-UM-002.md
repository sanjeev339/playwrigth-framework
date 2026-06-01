# Playwright Test Plan: TC-UM-002

## Test Case ID
TC-UM-002

## Module
User Management

## Test Case Title
Verify System Prevents Adding Internal User with an Existing Email Address

## Preconditions
1.  **User Authentication**: A user with administrative privileges must be successfully logged into the application.
    *   Login credentials (e.g., `process.env.ADMIN_USERNAME`, `process.env.ADMIN_PASSWORD`) must be configured in the test environment.
2.  **Existing User Data**: An internal user with the email address `sanjeevkumar.m00@gmail.com` must already exist in the system. This user is typically created by a preceding test case (e.g., `TC-UM-001`).
    *   The existing email address should be configured as an environment variable (e.g., `process.env.EXISTING_USER_EMAIL`) and its value must be `sanjeevkumar.m00@gmail.com`.

## Test Data
*   **Email Address**: `process.env.EXISTING_USER_EMAIL` (Value: `sanjeevkumar.m00@gmail.com`)
*   **First Name**: `adithya` (If required by form, use a generic valid value)
*   **Last Name**: `j` (If required by form, use a generic valid value)

## Business Flow

### Step 1: Navigate to User Management
*   **Action**: Navigate to the User Management section of the application.
*   **Expected Outcome**:
    *   Must: The URL contains `/user-management`.
    *   Must: The page title contains `User Management`.
    *   Must: A main heading `User Management` (or similar) is visible on the page.

### Step 2: Click "Add User"
*   **Action**: Locate and click the "Add User" button.
*   **Expected Outcome**:
    *   Optional (if visible): A dropdown menu or modal appears, presenting options like "Add Internal User" or "Add External User".

### Step 3: Click "Add Internal User"
*   **Action**: From the options presented (if any), click "Add Internal User".
*   **Expected Outcome**:
    *   Must: A form or modal titled `Add Internal User` (or similar heading) is displayed.
    *   Must: The URL contains `/user-management/add-internal-user` (if it's a new page) or a modal overlay is clearly visible.

### Step 4: Enter Existing Email Address
*   **Action**: In the "Email Address" input field, enter the existing email address: `process.env.EXISTING_USER_EMAIL`.
    *   *Note*: Other mandatory fields (e.g., First Name, Last Name) should also be filled with valid data if required by the form, but their values are not critical for this specific negative test case.
*   **Expected Outcome**:
    *   Must: The "Email Address" input field displays the entered value: `sanjeevkumar.m00@gmail.com`.

### Step 5: Click "Save"
*   **Action**: Locate and click the "Save" button on the "Add Internal User" form.
*   **Expected Outcome**:
    *   Must: An error message is displayed near the "Email Address" field or at the top of the form, explicitly stating `Email already exists.` (or similar wording like `This email is already registered.`).
    *   Must: The "Add Internal User" form remains open/visible, indicating that the user creation failed.
    *   Optional (if visible): A transient error toast/snackbar appears with a message indicating the failure to save due to a duplicate email.

## Notes for Dynamic UI States
*   **Loading Indicators**: Observe for any loading spinners or progress bars after clicking "Save" and ensure they disappear before asserting the error message.
*   **Error Message Placement**: The exact selector for the "Email already exists." error message might vary (e.g., `p.error-message`, `div[role="alert"]`, `span[data-testid="email-error"]`). Reconnaissance will be needed to identify the correct selector.
*   **Form Persistence**: Confirm that the form fields retain their entered values after the save attempt fails, which is common for validation errors.
