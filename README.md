# sauce-automation-v5 — Playwright Automation Framework

A practical Playwright + TypeScript automation framework using the Page Object Model (POM) pattern.

## Project Structure

```
sauce-automation-v5/
├── tests/              # Test spec files
├── page_object/        # Page Object classes (locators + low-level actions)
├── actions/            # Action classes (business-level orchestration)
├── helper/             # Shared utilities (TestHelper.ts)
├── test-data/          # Test data constants
├── screenshots/        # Failure screenshots (auto-generated)
├── playwright-report/  # HTML report (auto-generated)
├── test-results/       # JUnit XML results (auto-generated)
└── .github/workflows/  # CI pipeline
```

## Features Scaffolded

  - `Login` — tests/LoginTest.spec.ts
  - `Checkout` — tests/CheckoutTest.spec.ts

## Quick Start

```bash
# Install dependencies
pnpm install

# Install Playwright browsers
pnpm exec playwright install --with-deps chromium

# Run all tests (headless)
pnpm test

# Run in headed mode
pnpm test:headed

# Open HTML report
pnpm report
```

## Configuration

- **Base URL**: Set in `playwright.config.ts` → `use.baseURL`
- **Test Data**: Update values in `test-data/test-data.ts`
- **CI**: GitHub Actions workflow at `.github/workflows/playwright.yml`

## How to Add a New Feature

1. Create `page_object/{Feature}Page.ts` — define locators
2. Create `actions/{Feature}Action.ts` — orchestrate business steps
3. Create `tests/{Feature}Test.spec.ts` — write test cases
4. Add test data to `test-data/test-data.ts`

## Page Reconnaissance

Use the utility script to extract element locators from a live application page.

```bash
# Generate page object reconnaissance
npx ts-node utils/page-recon.ts <url>

# Example
npx ts-node utils/page-recon.ts https://backoffice.qa.zice.it/configuration/framework
```
