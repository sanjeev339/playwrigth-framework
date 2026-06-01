import { test, expect, type Locator, type Page } from '@playwright/test';

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}

function getLoginUrl(): string {
  const loginUrl =
    process.env.LOGIN_URL ??
    process.env.WEBSITE_URL ??
    (process.env.APP_BASE_URL
      ? `${process.env.APP_BASE_URL.replace(/\/+$/, '')}/${(process.env.LOGIN_PATH ?? 'login').replace(/^\/+/, '')}`
      : undefined);

  if (!loginUrl) {
    throw new Error('Missing LOGIN_URL, WEBSITE_URL, or APP_BASE_URL.');
  }

  return loginUrl;
}

async function firstUsable(locator: Locator): Promise<Locator | null> {
  const count = await locator.count().catch(() => 0);

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    const visible = await candidate.isVisible().catch(() => false);
    const enabled = await candidate.isEnabled().catch(() => false);

    if (visible && enabled) {
      return candidate;
    }
  }

  return null;
}

async function fillFirst(label: string, locators: Locator[], value: string): Promise<void> {
  for (const locator of locators) {
    const candidate = await firstUsable(locator);
    if (candidate) {
      await candidate.fill(value);
      return;
    }
  }

  throw new Error(`Unable to find input for ${label}.`);
}

async function clickFirst(label: string, locators: Locator[]): Promise<void> {
  for (const locator of locators) {
    const candidate = await firstUsable(locator);
    if (candidate) {
      await candidate.click();
      return;
    }
  }

  throw new Error(`Unable to find clickable control for ${label}.`);
}

async function clickMenuItemAfterRowAction(label: string, openMenu: () => Locator, item: () => Locator): Promise<void> {
  let candidate = await firstUsable(item());

  if (!candidate) {
    const opener = await firstUsable(openMenu());
    if (!opener) {
      throw new Error(`Unable to find row action menu opener for ${label}.`);
    }

    await opener.click();
    candidate = await firstUsable(item());
  }

  if (!candidate) {
    throw new Error(`Unable to find row menu item for ${label}.`);
  }

  await candidate.click();
}

async function selectCustomDropdown(page: Page, openDropdown: () => Locator, optionValue: string): Promise<void> {
  await openDropdown().click();

  const exactOptionRegex = new RegExp(`^${escapeRegex(optionValue)}$`, 'i');
  const optionCandidates = [
    page.getByRole('option', { name: exactOptionRegex }),
    page.locator('[role="listbox"], [role="menu"], [role="dialog"]').getByText(exactOptionRegex),
    page.locator('[aria-selected], [data-option], li').filter({ hasText: exactOptionRegex }),
    page.locator('li[role="option"]').filter({ hasText: exactOptionRegex }),
    page.getByText(exactOptionRegex)
  ];

  for (const locator of optionCandidates) {
    const candidate = await firstUsable(locator);
    if (candidate) {
      await candidate.click();
      await expect(page.getByText(exactOptionRegex).first()).toBeVisible({ timeout: 5000 });
      return;
    }
  }

  throw new Error(`No safe option locator found for dropdown value: ${optionValue}`);
}

test("TC-UM-001: User Management", async ({ page }) => {
  const loginEmail = process.env.LOGIN_EMAIL;
  const loginPassword = process.env.LOGIN_PASSWORD;
  const payload = {
    "First Name": "Priya",
    "Last Name": "Sharma",
    "Full Name": "Priya Sharma",
    "Email Address": "priya.sharma+auto001@piraiinfotech.com",
    "Role": "Executive",
    "Status": "Pending",
    "Created Date": "2026-04-01T12:00:00",
    "Created By": "Client_admin01"
  } as const;

  if (!loginEmail || !loginPassword) {
    throw new Error('Missing LOGIN_EMAIL or LOGIN_PASSWORD.');
  }

  await test.step('Login to the application', async () => {
    const loginUrl = getLoginUrl();
    await page.goto(loginUrl);

    await fillFirst('login email', [
      page.getByLabel(/email|username/i),
      page.getByRole('textbox', { name: /email|username/i }),
      page.getByPlaceholder(/email|username/i)
    ], loginEmail);

    await fillFirst('login password', [
      page.getByLabel(/password/i),
      page.getByRole('textbox', { name: /password/i }),
      page.getByPlaceholder(/password/i)
    ], loginPassword);

    await clickFirst('login submit', [
      page.getByRole('button', { name: /login|sign in|submit/i }),
      page.getByText(/login|sign in|submit/i)
    ]);

    await expect(page.getByRole("button", { name: /User Management/i })).toBeVisible({ timeout: 15000 });
  });

  await test.step("Step 1: Navigate to User Management", async () => {
    await page.getByRole("button", { name: /User Management/i }).click();
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  });

  await test.step("Step 2: Click Add User", async () => {
    await page.getByRole("button", { name: /Add User/i }).click();
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  });

  await test.step("Step 3: Click New Internal User", async () => {
    await page.getByText(/Add Internal User/i).click();
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  });

  await test.step("Step 4: Enter First Name", async () => {
    await page.getByRole("textbox", { name: /Enter first name/i }).fill(String(payload["First Name"]));
    await expect(page.getByRole("textbox", { name: /Enter first name/i })).toHaveValue(String(payload["First Name"]));
  });

  await test.step("Step 5: Enter Last Name", async () => {
    await page.getByRole("textbox", { name: /Enter last name/i }).fill(String(payload["Last Name"]));
    await expect(page.getByRole("textbox", { name: /Enter last name/i })).toHaveValue(String(payload["Last Name"]));
  });

  await test.step("Step 6: Enter Email Address", async () => {
    await page.getByRole("textbox", { name: /Enter email address/i }).fill(String(payload["Email Address"]));
    await expect(page.getByRole("textbox", { name: /Enter email address/i })).toHaveValue(String(payload["Email Address"]));
  });

  await test.step("Step 7: Select Role", async () => {
    await selectCustomDropdown(page, () => page.getByText(/Role/i), String(payload["Role"]));
  });

  await test.step("Step 8: Click Save", async () => {
    await page.getByRole("button", { name: /Save/i }).click();
    await page.waitForLoadState('networkidle').catch(() => undefined);
  });
});
