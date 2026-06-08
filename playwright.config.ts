import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const headless = String(process.env.HEADLESS ?? 'true').toLowerCase() === 'true';
const slowMo = Number(process.env.SLOW_MO ?? 0);
const reportDir = process.env.REPORT_OUTPUT_DIR ?? 'reports';
const testDir = process.env.PLAYWRIGHT_TEST_DIR ?? './tests';
const timeout = Number(process.env.PLAYWRIGHT_TEST_TIMEOUT_MS ?? 60_000);
const retries = Number(process.env.PLAYWRIGHT_RETRIES ?? 1);
const projectName = process.env.PLAYWRIGHT_PROJECT_NAME ?? 'Desktop Chrome';
const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir,
  timeout,
  retries,
  reporter: [
    ['html', { outputFolder: process.env.PLAYWRIGHT_HTML_REPORT_DIR ?? `${reportDir}/playwright-html`, open: 'never' }],
    ['json', { outputFile: process.env.PLAYWRIGHT_JSON_REPORT_PATH ?? `${reportDir}/playwright-report.json` }]
  ],
  use: {
    ...devices['Desktop Chrome'],
    headless,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    baseURL: process.env.WEBSITE_URL,
    storageState: fs.existsSync('playwright/.auth/user.json') ? 'playwright/.auth/user.json' : undefined,
    launchOptions: {
      slowMo
    }
  },
  projects: [
    {
      name: projectName,
      use: {
        ...devices['Desktop Chrome'],
        channel: browserChannel
      }
    }
  ]
});
