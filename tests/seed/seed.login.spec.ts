import { expect, test } from '@playwright/test';

test('seed login verifies credentials and landing state', async ({ page }) => {
  const websiteUrl = process.env.WEBSITE_URL;
  const loginEmail = process.env.LOGIN_EMAIL;
  const loginPassword = process.env.LOGIN_PASSWORD;

  expect(websiteUrl, 'WEBSITE_URL must be set').toBeTruthy();
  expect(loginEmail, 'LOGIN_EMAIL must be set').toBeTruthy();
  expect(loginPassword, 'LOGIN_PASSWORD must be set').toBeTruthy();

  await page.goto(websiteUrl!, { waitUntil: 'domcontentloaded' });
  const loginUrl = page.url();

  await page.getByLabel(/email|username/i).or(page.getByPlaceholder(/email|username/i)).first().fill(loginEmail!);
  await page.getByLabel(/password/i).or(page.getByPlaceholder(/password/i)).first().fill(loginPassword!);
  await page.getByRole('button', { name: /login|sign in|submit/i }).click();

  await expect
    .poll(
      async () => {
        const urlChanged = page.url() !== loginUrl;
        const landingVisible = await page
          .getByRole('main')
          .or(page.getByText(/dashboard|home|app/i))
          .first()
          .isVisible()
          .catch(() => false);

        return urlChanged || landingVisible;
      },
      { timeout: 15_000 }
    )
    .toBeTruthy();
});
