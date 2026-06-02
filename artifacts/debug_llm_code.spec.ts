import { test, expect, Page } from '@playwright/test';

test('TC-UM-003: Update User Role in User Management Module', async ({ page }) => {
  const payload = {
    "First Name": "adithya",
    "Last Name": "j",
    "Full Name": "adithya j",
    "Email Address": "sanjeevkumar.m00@gmail.com",
    "Role": "Workflow Operators"
  };

  // Login step
  await test.step('Login', async () => {
    const loginUrl = process.env.LOGIN_URL ?? process.env.WEBSITE_URL ?? (process.env.APP_BASE_URL ? `${process.env.APP_BASE_URL}/login` : '');
    await page.goto(loginUrl);
    await page.getByPlaceholder(/email|username/i).fill(process.env.LOGIN_EMAIL || '');
    await page.getByPlaceholder(/password/i).fill(process.env.LOGIN_PASSWORD || '');
    await page.getByRole('button', { name: /login|sign in|submit/i }).click();
  });

  // Step 1: Navigate to User Management.
  await test.step('Step 1: Navigate to User Management.', async () => {
    await page.getByRole('button', { name: /User Management/i }).click();
    await expect(page).toHaveURL('https://adminportal.dev.eigen-dyne.com/users/internal-user', { timeout: 15000 });
    await expect(page.getByRole('button', { name: /User Management/i })).toBeVisible({ timeout: 15000 });
  });

  // After login, assert visibility of first recon action selectedLocator
  await expect(page.getByRole('button', { name: /User Management/i })).toBeVisible({ timeout: 15000 });

  // Step 2: search the user by name or email.
  await test.step('Step 2: search the user by name or email.', async () => {
    // Locator failed, fallback to resilient locator for search input
    const searchInput = page.getByRole('searchbox', { name: /Search by name or email/i });
    if (await searchInput.count() === 0) {
      // fallback to textbox role
      const fallbackInput = page.getByRole('textbox', { name: /Search by name or email/i });
      if (await fallbackInput.count() === 0) {
        // fallback to placeholder
        await page.getByPlaceholder(/Search by name or email/i).fill(payload['Email Address']);
      } else {
        await fallbackInput.fill(payload['Email Address']);
      }
    } else {
      await searchInput.fill(payload['Email Address']);
    }
  });

  // Step 3: Click adithya j
  await test.step('Step 3: Click adithya j', async () => {
    await page.getByRole('row', { name: /adithya j sanjeevkumar\.m00@gmail\.com QA TEST MAGT - 2026-06-02, 10:52 Active/i }).click();
    await expect(page).toHaveURL(/\/users\/user-detail\//, { timeout: 15000 });
  });

  // Step 4: Select Edit .
  await test.step('Step 4: Select Edit .', async () => {
    await page.getByRole('button', { name: /Edit/i }).click();
    await expect(page).toHaveURL(/\/users\/user-detail\//, { timeout: 15000 });
  });

  // Step 5: Click Role
  await test.step('Step 5: Click Role', async () => {
    // Locator failed, fallback to fallbackLocators with force click
    const roleInputLocator = page.locator('xpath=/html/body/div[2]/div[1]/div[2]/div[1]/div[2]/div[4]/div[1]/div[1]/div[1]/div[1]/input[1]');
    if (await roleInputLocator.count() > 0) {
      await roleInputLocator.click({ force: true });
    } else {
      // fallback to text locator
      const fallbackTextLocator = page.getByText(/Role/i);
      if (await fallbackTextLocator.count() > 0) {
        await fallbackTextLocator.click({ force: true });
      }
    }
  });

  // Step 6: Select Role
  await test.step('Step 6: Select Role', async () => {
    const dropdownLocator = page.locator('xpath=/html/body/div[2]/div[1]/div[2]/div[1]/div[2]/div[4]/div[1]/div[1]/div[1]/div[1]/input[1]');
    await dropdownLocator.click({ force: true });
    const optionLocator = page.getByRole('option', { name: /Workflow Operators/i });
    await optionLocator.click();
    await expect(page).toHaveURL(/\/users\/user-detail\//, { timeout: 15000 });
  });

  // Step 7: Click Save
  await test.step('Step 7: Click Save', async () => {
    // No selectedLocator, fallback to button with name Save
    const saveButton = page.getByRole('button', { name: /Save/i });
    await saveButton.click();
    await expect(page).toHaveURL(/\/users\/user-detail\//, { timeout: 15000 });
  });

  // Post-action assertion: User role is updated successfully
  // Check that the Role dropdown reflects the chosen role after save
  await expect(page.locator('xpath=/html/body/div[2]/div[1]/div[2]/div[1]/div[2]/div[4]/div[1]/div[1]/div[1]/div[1]/input[1]')).toHaveValue(payload['Role'], { timeout: 15000 });
});
