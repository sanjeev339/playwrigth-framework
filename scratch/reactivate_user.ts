import { chromium } from '@playwright/test';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  console.log('Navigating to login page...');
  await page.goto('https://adminportal.dev.eigen-dyne.com/login');
  
  console.log('Logging in...');
  await page.getByRole('textbox', { name: /email/i }).or(page.getByLabel(/email|username/i)).fill('saikiranv@piraiinfo.com');
  await page.getByLabel(/password/i).fill('Rblb@123');
  await page.getByRole('button', { name: /login|sign in|submit/i }).click();
  
  await page.waitForLoadState('networkidle').catch(() => undefined);
  console.log('Logged in. Current URL:', page.url());
  
  console.log('Navigating to User Management...');
  await page.getByRole('button', { name: /^User Management$/i }).click();
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(2000);
  
  console.log('Searching for user...');
  await page.getByPlaceholder(/Search by name or email/i).fill('sanjeevkumar.m00@gmail.com');
  await page.waitForTimeout(2000);
  
  console.log('Opening actions menu...');
  const row = page.getByRole('row', { name: /sanjeevkumar\.m00@gmail\.com/i });
  await row.locator('button').first().click();
  await page.waitForTimeout(1000);
  
  const reactivateOption = page.getByRole('link', { name: /^Reactivate$/i });
  const isReactivateVisible = await reactivateOption.isVisible();
  console.log('Is Reactivate option visible?', isReactivateVisible);
  
  if (isReactivateVisible) {
    console.log('Clicking Reactivate...');
    await reactivateOption.click();
    await page.waitForTimeout(1000);
    
    const commentsInput = page.locator('textarea').first();
    if (await commentsInput.isVisible()) {
      console.log('Entering comments...');
      await commentsInput.fill('reactivating user for testing');
    }
    
    const confirmButton = page.getByRole('button', { name: /^Reactivate$/i }).or(page.getByRole('button', { name: /confirm/i })).or(page.getByRole('button', { name: /^Activate$/i }));
    console.log('Clicking confirm button...');
    await confirmButton.click();
    await page.waitForTimeout(3000);
    console.log('User reactivated successfully!');
  } else {
    console.log('User is already active!');
  }
  
  await browser.close();
}

run().catch(console.error);
