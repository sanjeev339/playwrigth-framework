# Test Plan: TC-UM-001 - Add New Internal User in User Management

## Module
User Management

## Objective
Verify that a new internal user can be created successfully with the status "Pending" and is visible in the User Management list.

---

## Preconditions
- Tester has valid environment credentials with permissions to add users.
- The application is accessible and the tester is logged in using environment credentials.
- The User Management module is accessible from the main navigation.
- No existing user conflicts with the email address `priya.sharma+auto001@piraiinfotech.com`.

---

## Test Data
| Field          | Value                                |
|----------------|------------------------------------|
| First Name     | Priya                              |
| Last Name      | Sharma                             |
| Full Name      | Priya Sharma                      |
| Email Address  | priya.sharma+auto001@piraiinfotech.com |
| Role           | ADMIN 1                           |
| Expected Status| Pending                           |

---

## Step-by-Step Business Flow & Assertions

### Step 1: Navigate to User Management
- **Action:** Navigate to the User Management page via the main menu.
- **Assertion:** Confirm the User Management page is displayed by verifying the page title or a unique page element.

### Step 2: Click on Add User
- **Action:** Click the "Add User" button.
- **Assertion:** Verify that the Add User form/modal is displayed.

### Step 3: Click on New Internal User
- **Action:** Within the Add User options, select "New Internal User".
- **Assertion:** Confirm the New Internal User form is loaded and ready for input.

### Step 4: Enter First Name and Last Name
- **Action:** Input "Priya" into the First Name field and "Sharma" into the Last Name field.
- **Assertion:** Verify that the Full Name field reflects "Priya Sharma" (concatenation of first and last name).

### Step 5: Enter Email Address
- **Action:** Enter the email address `priya.sharma+auto001@piraiinfotech.com` into the Email Address field.
- **Assertion:** Confirm the Email Address field contains the entered email.

### Step 6: Select Role
- **Action:** Select the role "ADMIN 1" from the Role dropdown.
- **Assertion:** Verify the Role dropdown reflects the selected role "ADMIN 1".

### Step 7: Click Save
- **Action:** Click the Save button to submit the new user form.
- **Assertion:** 
  - Confirm the form closes or navigates back to the User Management list.
  - Verify the new user "Priya Sharma" appears in the user list.
  - Confirm the user's status is displayed as "Pending".
  - Optionally verify other user details such as email and role in the list.

---

## Notes on Dynamic UI States
- The User Management page and Add User form may load asynchronously; implement waits for page readiness and element visibility.
- The Full Name field may auto-populate or concatenate first and last names dynamically; verify this behavior before proceeding.
- Role dropdown options may vary based on user permissions or environment; ensure "ADMIN 1" is available before selection.
- The user list may paginate or filter; ensure the newly added user is visible or adjust filters accordingly.
- Status "Pending" may take a moment to update after save; include retries or waits for status verification.

---

## Environment & Credentials
- Use environment variables or secure vaults to inject login credentials.
- Do NOT hardcode any username, password, or tokens in the test scripts.

---

## Summary
This test validates the end-to-end flow of adding a new internal user with valid data, ensuring the user is created with the correct details and status "Pending" is reflected in the User Management list.
