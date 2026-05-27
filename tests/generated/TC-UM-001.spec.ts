import { test, expect } from '@playwright/test';

test('TC-UM-001: Add New Internal User in User Management', async ({ page }) => {
  const baseURL = process.env.WEBSITE_URL;
  const loginEmail = process.env.LOGIN_EMAIL;
  const loginPassword = process.env.LOGIN_PASSWORD;

  const payload = {
    firstName: 'Priya',
    lastName: 'Sharma',
    fullName: 'Priya Sharma',
    emailAddress: 'priya.sharma+auto001@piraiinfotech.com',
    role: 'ADMIN 1',
    status: 'Pending',
  };

  // Login function
  await test.step('Login to the application', async () => {
    await page.goto(`${baseURL}/login/`);
    // Enter Email Address
    await page.getByRole('textbox', { name: /Email Address \*/i }).fill(loginEmail || '');
    // Enter Password
    await page.getByRole('textbox', { name: /Password \*/i }).fill(loginPassword || '');
    // Click Login button
    await page.getByRole('button', { name: /Login/i }).click();
    // Assert login success alert
    await expect(page.getByRole('alert', { name: /Login successful Success/i })).toBeVisible({ timeout: 10000 });
  });

  await test.step('Navigate to User Management', async () => {
    // Click on User Management button in main navigation
    const userManagementButton = page.getByRole('button', { name: /User Management/i });
    await userManagementButton.click();
    // Assert User Management page is displayed by checking presence of "Internal Users" button
    await expect(page.getByRole('button', { name: /Internal Users/i })).toBeVisible({ timeout: 10000 });
  });

  await test.step('Click on Add User', async () => {
    // Click Add User button
    const addUserButton = page.getByRole('button', { name: /Add User/i });
    await addUserButton.click();
    // Assert Add User form/modal is displayed by checking presence of "New Internal User" button
    await expect(page.getByRole('button', { name: /New Internal User/i })).toBeVisible({ timeout: 10000 });
  });

  await test.step('Click on New Internal User', async () => {
    // Click New Internal User button
    const newInternalUserButton = page.getByRole('button', { name: /New Internal User/i });
    await newInternalUserButton.click();
    // Assert New Internal User form is loaded by checking presence of First Name input
    await expect(page.getByLabel(/First Name/i)).toBeVisible({ timeout: 10000 });
  });

  await test.step('Enter First Name and Last Name', async () => {
    // Fill First Name
    await page.getByLabel(/First Name/i).fill(payload.firstName);
    // Fill Last Name
    await page.getByLabel(/Last Name/i).fill(payload.lastName);
    // Assert Full Name field shows concatenated full name
    const fullNameInput = page.getByLabel(/Full Name/i);
    await expect(fullNameInput).toHaveValue(payload.fullName);
  });

  await test.step('Enter Email Address', async () => {
    // Fill Email Address
    await page.getByRole('textbox', { name: /Email Address/i }).fill(payload.emailAddress);
    // Assert Email Address field contains entered email
    const emailInput = page.getByRole('textbox', { name: /Email Address/i });
    await expect(emailInput).toHaveValue(payload.emailAddress);
  });

  await test.step('Select Role', async () => {
    // Select Role from dropdown
    const roleDropdown = page.getByRole('combobox', { name: /Role/i });
    await roleDropdown.selectOption({ label: payload.role });
    // Assert Role dropdown reflects selected role
    await expect(roleDropdown).toHaveValue(payload.role);
  });

  await test.step('Click Save', async () => {
    // Click Save button
    const saveButton = page.getByRole('button', { name: /Save/i });
    await saveButton.click();
    // Wait for navigation or form close - assume navigation back to user list
    await page.waitForURL('**/users/internal-user', { timeout: 10000 });
    // Assert Add User form is closed by checking Add User button is visible again
    await expect(page.getByRole('button', { name: /Add User/i })).toBeVisible({ timeout: 10000 });
  });

  await test.step('Verify new user is listed with Pending status', async () => {
    // Search for the new user by full name or email
    const searchInput = page.getByRole('textbox', { name: /Search by name or email/i });
    await searchInput.fill(payload.emailAddress);
    // Wait for search results to update
    await page.waitForTimeout(1000);

    // Locate the row containing the new user's full name and email
    const userRow = page.locator('table tbody tr').filter({
      has: page.getByRole('cell', { name: new RegExp(`${payload.fullName}`, 'i') }),
      hasText: payload.emailAddress,
    }).first();

    await expect(userRow).toBeVisible({ timeout: 10000 });

    // Assert user status is Pending
    const statusCell = userRow.getByRole('cell', { name: new RegExp(payload.status, 'i') });
    await expect(statusCell).toBeVisible();

    // Optionally assert role cell matches selected role
    const roleCell = userRow.getByRole('cell', { name: new RegExp(payload.role, 'i') });
    await expect(roleCell).toBeVisible();
  });
});
