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

## MCP Playwright Generator

This repo includes a local MCP server that can generate framework code from a
structured test case and test data.

```bash
# Start the MCP stdio server
corepack pnpm mcp:server

# Preview generated files without writing them
corepack pnpm mcp:generate mcp-server/examples/invalid-login.request.json --dry-run

# Preview generation from OrchestAI scenario/data artifacts
corepack pnpm mcp:generate:artifacts TC-UM-001 /path/to/scenarios_combined.csv /path/to/test_data.json https://app.example.com

# Write generated files when the input is ready
corepack pnpm mcp:generate path/to/request.json
```

The generator creates or previews these framework files:

```text
page_objects/{feature}/{Feature}Page.ts
actions/{feature}/{Feature}Action.ts
test-data/{feature}/{feature}.data.ts
tests/{feature}/{feature}.spec.ts
fixtures/page.fixture.ts
fixtures/test.fixture.ts
```

Before writing code, it validates generated output for stability rules like no
hard sleeps, no XPath locators, no direct browser operations inside specs, no
environment access outside config, and required assertion flow.

The MCP server exposes two generation tools:

- `generate_playwright_test` accepts already-structured Playwright generation JSON.
- `generate_playwright_from_artifacts` accepts `scenarios_combined.csv`,
  `test_data.json`, and a `scenarioId`, then converts that reference format into
  the structured generator input.
