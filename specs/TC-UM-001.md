# Playwright Test Plan: TC-UM-001 - Create New Internal User

## Module
User Management

## Test Case ID
TC-UM-001

## Test Case Title
Verify that a new internal user can be successfully created and listed with a 'Pending' status in User Management.

## Preconditions
*   The application is accessible at `process.env.BASE_URL`.
*   An administrator user account exists with the necessary permissions to create new users.
*   The administrator user is successfully logged into the application using credentials from environment variables (`process.env.ADMIN_USERNAME`, `process.env.ADMIN_PASSWORD`).

## Test Data
*   **First Name:** `Priya`
*   **Last Name:** `Sharma`
*   **Full Name:** `Priya Sharma`
*   **Email Address:** `priya.sharma+auto001@piraiinfotech.com`
*   **Role:** `Executive`
*   **Status:** `Pending`

## Business Flow

### Step 1: Navigate to User Management
*   **Action:**
    *   Navigate to the User Management section of the application.
    *   _Example Playwright:_ `await page.goto(process.env.BASE_URL + '/user-management');`
*   **Assertions:**
    *   **Must:** The current URL contains `/user-management`.
    *   **Must:** The page title is "User Management" or similar.
    *   **Must:** A prominent heading (e.g., `h1`, `h2`) with the text "User Management" is visible.

### Step 2: Click Add User
*   **Action:**
    *   Click on the "Add User" button.
    *   _Example Playwright:_ `await page.click('button:has-text("Add User")');`
*   **Assertions:**
    *   **Optional (if visible):** A dropdown menu or modal containing options like "New Internal User" and "New External User" is displayed.

### Step 3: Click New Internal User
*   **Action:**
    *   From the "Add User" options, click on "New Internal User".
    *   _Example Playwright:_ `await page.click('text="New Internal User"');`
*   **Assertions:**
    *   **Must:** A form or modal for "Add New User" or "Create Internal User" is displayed.
    *   **Must:** A prominent heading (e.g., `h3`, `h4`) with text like "Add New User" or "Create Internal User" is visible within the form/modal.

### Step 4: Enter First Name
*   **Action:**
    *   Enter `Priya` into the "First Name" input field.
    *   _Example Playwright:_ `await page.fill('input[name="firstName"]', 'Priya');`
*   **Assertions:**
    *   **Must:** The "First Name" input field displays the value `Priya`.

### Step 5: Enter Last Name
*   **Action:**
    *   Enter `Sharma` into the "Last Name" input field.
    *   _Example Playwright:_ `await page.fill('input[name="lastName"]', 'Sharma');`
*   **Assertions:**
    *   **Must:** The "Last Name" input field displays the value `Sharma`.

### Step 6: Enter Email Address
*   **Action:**
    *   Enter `priya.sharma+auto001@piraiinfotech.com` into the "Email Address" input field.
    *   _Example Playwright:_ `await page.fill('input[name="email"]', 'priya.sharma+auto001@piraiinfotech.com');`
*   **Assertions:**
    *   **Must:** The "Email Address" input field displays the value `priya.sharma+auto001@piraiinfotech.com`.

### Step 7: Select Role
*   **Action:**
    *   Select `Executive` from the "Role" dropdown.
    *   _Example Playwright (for a standard select):_ `await page.selectOption('select[name="role"]', { label: 'Executive' });`
    *   _Example Playwright (for a custom dropdown):_ `await page.click('//label[text()="Role"]/following-sibling::div//input'); await page.click('text="Executive"');`
*   **Assertions:**
    *   **Must:** The "Role" dropdown/selector visibly displays `Executive` as the selected value.

### Step 8: Click Save
*   **Action:**
    *   Click on the "Save" button to create the user.
    *   _Example Playwright:_ `await page.click('button:has-text("Save")');`
*   **Assertions:**
    *   **Optional (if visible):** A success toast, snackbar, or banner appears with text such as "User added successfully" or "New user created".
    *   **Must:** The user is redirected back to the User Management list page (or the form closes and the list updates).
    *   **Must:** The user list contains a row or card for `Priya Sharma`.
    *   **Must:** Within the `Priya Sharma` entry, the email address `priya.sharma+auto001@piraiinfotech.com` is displayed.
    *   **Must:** Within the `Priya Sharma` entry, the role `Executive` is displayed.
    *   **Must:** Within the `Priya Sharma` entry, the status `Pending` is displayed.

## Notes
*   **Dynamic UI Reconnaissance:**
    *   The exact locators for "Add User" button, "New Internal User" menu item, input fields (First Name, Last Name, Email Address), Role dropdown, and "Save" button need to be identified during initial UI reconnaissance. Prioritize robust locators (e.g., `data-testid`, `role`, `name`, `aria-label`).
    *   The method for selecting a role might vary (standard `<select>` vs. custom dropdown component). The Playwright action should be adapted accordingly.
    *   The structure of the user list (e.g., HTML table, list of cards) needs to be confirmed to write accurate assertions for finding the newly created user and verifying its details.
    *   The exact text for success messages (toasts/snackbars) should be confirmed if they are to be asserted.
*   **Email Uniqueness:** Ensure the email `priya.sharma+auto001@piraiinfotech.com` is unique for each test run or that the system handles duplicate email attempts gracefully (e.g., by allowing creation but marking as pending, or rejecting with an error). For production-quality tests, consider generating a unique email address for each run (e.g., using a timestamp or UUID).
*   **Role Availability:** The `Executive` role must exist and be selectable in the system.
