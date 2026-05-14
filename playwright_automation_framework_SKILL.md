---
name: playwright-automation-framework-strict
description: Use this skill whenever the user asks to write, generate, scaffold, extend, or refactor Playwright test automation code (TypeScript) inside an enterprise framework that uses the layered structure tests/, fixtures/, core/, page_objects/, actions/, utils/, test-data/, api/. Triggers include any mention of "write a Playwright test", "automate this scenario", "add a spec", "create a page object", "create an action", "generate automation code", or any request that produces a *.spec.ts, *Page.ts, *Action.ts, or *.fixture.ts file. This skill enforces strict layer separation, mandates reuse of existing common files (fixtures, actions, page objects, utils) before creating new ones, and rejects anti-patterns like locators in actions, business logic in page objects, hardcoded data, or direct Playwright page usage in tests. Do NOT use this skill for non-Playwright test frameworks (Cypress, Selenium, WebdriverIO), unit tests, API-only suites without UI, or one-off throwaway scripts that are not part of the framework.
---
# Playwright Automation Framework — Strict Mode
 
This is a **NON-NEGOTIABLE enforcement skill** for generating Playwright automation code in an enterprise-grade, layered TypeScript framework.
 
The single most important behavior this skill enforces: **REUSE BEFORE CREATE.** Every request to generate a test, action, page object, fixture, or util MUST begin by inspecting the existing codebase AND the live application before writing a single line of code.
 
Violations of any rule below are a **failure of generation quality** — Claude must regenerate, not ship.
 
---
 
## Rule 0 — Mandatory Discovery Phase (RUN BEFORE WRITING ANY CODE)
 
Before generating a single line of code, Claude MUST complete BOTH phases of discovery:
 
### Phase A — Codebase Discovery
 
Each test script in this framework is **independently created per feature/function**. Scripts do NOT reuse or depend on each other. Therefore, Claude MUST NOT read previously created test scripts — they are irrelevant to any new script being created.
 
**The only shared foundation is `core/`.**
 
1. **Always read `core/` subfolders (every request, no exceptions):**
   | Subfolder | What to extract |
   |---|---|
   | `core/base/` | Base class names, constructor signatures, extended methods |
   | `core/config/` | Config loader usage, env variable access patterns |
   | `core/constants/` | Available constants and their names |
   | `core/logger/` | Logger import path and usage pattern |
   | `config/` | Environment-specific parameters (URLs, credentials) from `*.json` |
   > These are the foundation for every new script.
   > ✅ Always read `.env` and `config/${ENV}.json` to resolve environment-specific logic.
   > ❌ Do NOT read `tests/`, `fixtures/`, `actions/`, `page_objects/` — those are all independent scripts, not shared assets.
2. **Read login files ONLY when the test requires authentication:**
   - If the test needs login → read ONLY these exact files, nothing else:
   | File | Purpose |
   |---|---|
   | `page_objects/auth/LoginPage.ts` | Login UI locators and interactions |
   | `actions/auth/LoginAction.ts` | Login business logic and workflow |
   | `tests/auth/login.spec.ts` | Login test specification reference |
   | `test-data/auth/login.data.ts` | Login test data and credentials |
   | `archive/LoginTest.spec.ts` | Archived login test reference (read-only, do not modify) |
   > ✅ Go directly to each file by exact path — do NOT scan `page_objects/`, `actions/`, `tests/`, or `test-data/` folders.
   > ✅ If any of the above files do not exist, create them at the exact path listed above.
   > ❌ Never read any other file outside this list for login-related tasks.
   - If the test does NOT need login → skip all of the above entirely
3. **Read nothing else.** Every new script is a fresh, self-contained file that imports only from `core/`.
   > ✅ This keeps token usage minimal — only the shared foundation is ever read, regardless of how many scripts (100s) already exist.
   > ✅ Never scan the full project tree looking for reuse — there is nothing to reuse except `core/`.
---
 
### Phase A — Warm Session Optimisation (Context-Aware Reading)
 
The Phase A rules above apply in full to **cold sessions** (a fresh conversation with no prior context). Within a **warm session** — where files have already been read earlier in the same conversation — the following optimisation applies:
 
| File category | Cold session (new conversation) | Warm session (files already in context) |
|---|---|---|
| `core/` subfolders | ✅ Always read | ✅ Skip — already in context |
| Login files (LoginPage, LoginAction, etc.) | ✅ Read if test needs auth | ✅ Skip — already in context |
| `config/${ENV}.json` + `.env` | ✅ Always read | ✅ Skip — already in context |
| Target screen Page Object (new screen) | ❌ Does not exist yet | ❌ Does not exist yet — CREATE via Phase B |
| Phase B live browser recon | ✅ Always run per new screen | ✅ Always run per new screen — NEVER skip |
 
**Decision rule — apply before every script generation request:**
 
```
IF files were already read earlier in this conversation
   AND no `core/` files have changed since they were read
   THEN skip Phase A re-reads and proceed directly to Phase B
ELSE (new conversation OR files may have changed)
   THEN execute full Phase A before Phase B
```
 
> ✅ Within one session, generating 10 scripts saves 9× the Phase A read cost.
> ✅ Phase B live recon is NEVER skipped — the live DOM may change between scripts even in the same session.
> ❌ Do NOT skip Phase A in a new conversation — context is always empty at session start.
> ❌ Do NOT assume `core/` is unchanged if the user says they edited it — re-read if in doubt.
 
---
 
### Phase A — Dependency Existence Check (MANDATORY before writing any import)
 
Before generating ANY file that imports from another project file (fixture, page object, action, util, test-data), Claude MUST verify that the imported file **physically exists on disk** using `filesystem:list_directory` or `filesystem:read_text_file`.
 
**This check is NOT optional and NOT skippable — even in a warm session.**
 
Context memory is NOT a substitute for disk verification. A file that was generated in a previous conversation may not have been saved, may have been deleted, or may never have been written. Claude's memory of writing it is unreliable.
 
**Rule: For every `import` statement in a new file, ask: does this file exist on disk right now?**
 
```
FOR EACH import path in the new file being generated:
  IF the imported path points to a project file (not node_modules, not @playwright/test)
    THEN call filesystem:list_directory on the parent folder
    IF file is missing → CREATE it immediately, before writing the importing file
    IF file exists     → proceed
```
 
**Violation examples (auto-reject):**
```ts
// add-pillar.fixture.ts
import { test as base } from './pillars.fixture';   // ← MUST verify pillars.fixture.ts exists on disk first
import { PillarsPage } from '../page_objects/pillars/PillarsPage';  // ← MUST verify PillarsPage.ts exists
import { AddPillarAction } from '../actions/pillars/AddPillarAction'; // ← MUST verify AddPillarAction.ts exists
```
 
**Correct workflow:**
1. List `fixtures/` → confirm `pillars.fixture.ts` is present → if not, create it
2. List `page_objects/pillars/` → confirm `PillarsPage.ts` is present → if not, create it
3. List `actions/pillars/` → confirm `AddPillarAction.ts` is present → if not, create it
4. Only then write `add-pillar.fixture.ts`
> ✅ The order is: dependencies first, dependent file last.
> ❌ Never write a file that imports a file you have not confirmed exists on disk.
> ❌ "I generated it earlier" is NOT confirmation — disk state is ground truth.
 
---
 
### Phase B — Live Application Reconnaissance (MANDATORY before writing any Page Object)
 
**The spec document and existing code are often wrong or outdated. Ground truth comes from the browser.**
 
Before writing any page object locators, Claude MUST verify every selector against the real DOM. There are three ways to do this, in order of preference:
 
---
 
#### Phase B — Option 1: Page Recon Utility (RECOMMENDED — fastest, most complete)
 
The framework ships a built-in reconnaissance script at `utils/page-recon.ts`.
Run it locally from your terminal before asking Claude to write any Page Object.
 
```bash
# Run against any page — opens a headed browser, extracts ALL element attributes
npx ts-node utils/page-recon.ts <url> [outputDir]
 
# Examples:
npx ts-node utils/page-recon.ts https://backoffice.qa.zice.it/login
npx ts-node utils/page-recon.ts https://backoffice.qa.zice.it/configuration/framework ./recon-output
```
 
**What it produces in `./recon-output/` (or your chosen outputDir):**
 
```
recon-output/
  ├── screenshot-<pageName>.png      ← full-page visual
  ├── locators-<pageName>.json       ← all element attributes as JSON
  └── locators-<pageName>.md         ← ready-to-paste locator map for Claude
```

### Phase B (Extended) — Field Constraint Extraction
During live recon, for every input field found, Claude MUST also record:
- `maxlength` / `minlength` HTML attributes
- `type` attribute (text, email, number, url, tel)
- `min` / `max` attributes on number/date inputs
- `pattern` attribute (regex validation)
- `required` attribute
- Placeholder text (often hints at format)

Record these in the locator map alongside selectors:
```json
{
  "field": "frameworkName",
  "selector": "[data-testid='framework-name']",
  "type": "text",
  "maxlength": 50,
  "required": true,
  "pattern": "^[a-zA-Z0-9 ]+$"
}
```
These constraints drive the boundary test cases in Rule 18.

**What the .md locator map looks like (sample for the Zice login page):**
 
```markdown
### `input` — Enter Email Address
 
| Attribute   | Value                    |
|-------------|--------------------------|
| id          | `Email Address`          |
| name        | `email`                  |
| type        | `email`                  |
| placeholder | `Enter Email Address`    |
| data-pc-name| `inputtext`              |
| xpath       | `//*[@id="Email Address"]` |
 
Suggested Playwright locators (priority order):
1. `page.getByPlaceholder('Enter Email Address')`
2. `page.locator('[id="Email Address"]')`
3. `page.locator('input[name="email"]')`
4. `page.locator('xpath=//*[@id="Email Address"]')`
```
 
**How to give it to Claude:**
> "Here is the recon output for the login page: [paste .md content].
> Write the LoginPage.ts using these verified locators."
 
Claude MUST use the locators from the recon report and NOT invent or guess any selector.
 
---
 
#### Phase B — Option 2: Playwright Codegen
 
If the page requires interaction (login, multi-step navigation) before reaching the target screen, use Playwright Codegen to record the full flow:
 
```bash
# Opens headed browser — interact manually, code is recorded automatically
npx playwright codegen https://backoffice.qa.zice.it/login
```
 
Copy the generated raw script and paste it to Claude:
> "Here is the codegen output for the framework creation flow.
> Refactor this into a Page Object + Action + Fixture following the framework rules."
 
---
 
#### Phase B — Option 3: Screenshot + DevTools (manual fallback)
 
If you cannot run scripts locally, take a browser screenshot AND open DevTools (F12 or right-click → Inspect on any element) to capture attributes manually.
 
**What a screenshot tells you:**
 
```
┌────────────────────────────┐
│  Email Address             │  ← label text only (visible in screenshot)
│  ┌──────────────────────┐  │
│  │  Enter Email Address │  │  ← placeholder text only (visible in screenshot)
│  └──────────────────────┘  │
└────────────────────────────┘
```
 
**What DevTools reveals (right-click → Inspect on the input):**
 
```html
<input
  id="Email Address"        ← NOT visible in screenshot
  name="email"              ← NOT visible in screenshot
  type="email"              ← NOT visible in screenshot
  placeholder="Enter Email Address"
  data-pc-name="inputtext"  ← NOT visible in screenshot
/>
```
 
> ⚠ A screenshot alone is NEVER sufficient for writing locators.
> Always pair a screenshot with either DevTools attributes or the recon utility output.
 
**What DevTools CANNOT be automated:**
Playwright controls the page content — not the browser's own UI. DevTools is a Chrome-internal panel that lives outside the page, so Playwright cannot open it, click it, or screenshot it. The `page-recon.ts` utility is the automated equivalent: it extracts the same attributes programmatically, without needing DevTools at all.
 
---
 
**Whichever option is used, Claude MUST output a "Recon Summary" before writing code:**
 
```
Recon Summary (Phase B findings):
- Source: recon utility / codegen / manual DevTools
- Email input  : id="Email Address", name="email", placeholder="Enter Email Address"
- Password     : id="Password", name="password", placeholder="Enter Password"
- Login button : type="submit", text="Login", data-pc-name="button"
- Toast        : class contains "z-[10000]", message=span[0], status=span[1]
- Post-login URL: /dashboard  (h1 "Dashboard" is the ready signal)
- ⚠ Spec said: checkbox required. Reality: no checkbox exists in live DOM.
```
 
> ❌ Forbidden: Writing `page.locator('input#userName')` when the live DOM shows `input[name="email"]`.
> ❌ Forbidden: Assuming a checkbox exists because the spec mentions it without verifying in the browser.
> ✅ Required: Every locator in a Page Object must match a live DOM element from Phase B recon.
 
---
 
## Rule 1 — Folder Structure (MANDATORY)
 
All generated code MUST live in this structure. No new top-level folders. No mixing.
 
| Folder            | Contains                                      | Forbidden                                  |
| ----------------- | --------------------------------------------- | ------------------------------------------ |
| `tests/`        | `*.spec.ts` only — thin specs              | locators, business logic, raw `page` use |
| `fixtures/`     | `*.fixture.ts` — DI for actions/pages/data | test logic, assertions                     |
| `core/`         | `BaseTest`, `BasePage`, config, hooks     | feature-specific code                      |
| `page_objects/` | `*Page.ts` — UI abstraction                | workflows, assertions                      |
| `actions/`      | `*Action.ts` — business workflows          | raw locators, assertions*                  |
| `utils/`        | pure stateless helpers                        | Playwright `page`, business logic        |
| `test-data/`    | JSON/TS static inputs                         | logic, env values                          |
| `config/`       | `*.json` — Environment specific config    | logic, credentials not in JSON             |
| `reports/`      | Test artifacts, screenshots, videos       | source code, test data                     |
| `api/`          | API client abstraction                        | UI logic                                   |
 
\* Validation helpers (`expect…ToBeVisible`-style wrappers) are allowed in actions only when explicitly named as such (e.g. `verifyOrderConfirmed`).
 
---
 
## Rule 2 — Layer Responsibilities (Strict)
 
### Tests (`tests/*.spec.ts`)
 
**Allowed:** import fixtures, call action methods, run `expect(...)` assertions, set up test-level data.
**Forbidden:** `page.locator(...)`, `page.click(...)`, raw selectors, multi-step business logic, instantiating page objects with `new`.
 
### Actions (`actions/*Action.ts`)
 
**Allowed:** call methods on injected page objects, compose multi-page workflows, accept typed input data, wrap steps in `test.step()`.
**Forbidden:** raw locators, `page.click/fill/locator`, hardcoded data, environment lookups.
 
### Page Objects (`page_objects/*Page.ts`)
 
**Allowed:** locators (as private readonly fields), single-screen interactions (`click`, `fill`, `getText`, `isVisible`), page-level navigation.
**Forbidden:** cross-page workflows, `expect(...)` assertions, knowledge of test data structure beyond primitives.
 
### Fixtures (`fixtures/*.fixture.ts`)
 
**Allowed:** instantiate page objects + actions, inject them via Playwright's `test.extend`, manage setup/teardown for the test context, extend existing fixture chains.
**Forbidden:** assertions, business logic, navigation flows.
 
### Core (`core/`)
 
**Allowed:** `BaseTest`, `BasePage` abstract classes, config loader, env resolution, global hooks.
**Forbidden:** feature-specific code, anything tied to one screen.
 
### Utils (`utils/`)
 
**Allowed:** pure functions — date formatting, random data, string manipulation, type guards.
**Forbidden:** anything that takes a Playwright `Page`, anything that knows about a feature, statefulness.
 
---
 
## Rule 3 — Reusability Enforcement (CRITICAL)
 
This is the rule the framework lives or dies on.
 
1. **Search before create.** For every artifact in the Reuse Plan, attempt REUSE → EXTEND → CREATE in that order.
2. **Extend over duplicate.** If `CheckoutPage` exists and the request needs one new interaction on the checkout screen, ADD a method to `CheckoutPage`. Do NOT create `CheckoutPaymentPage` unless it is genuinely a different screen.
3. **One screen = one Page Object.** Never split the same screen across files.
4. **One business flow = one Action method.** If `LoginAction.loginAsUser(user)` exists, do not write `LoginAction.performLogin(user)` — call the existing one.
5. **Shared data lives in `test-data/`.** Never inline a user, product, or URL that another spec might also need.
6. **Shared waits / generators / parsers live in `utils/`.** If you write the same helper twice across actions, lift it.
7. **Imports must be explicit.** Use named imports from existing modules; do not redeclare types or interfaces that already exist in `core/` or shared `types/`.
> If Claude cannot find an existing asset and is unsure whether one exists, **ask the user** rather than create a duplicate.
 
---
 
## Rule 4 — Dependency Injection (Required Pattern)
 
The only allowed flow is:
 
```
Test  →  Fixture  →  Action  →  Page Object  →  Playwright Page
```
 
Tests MUST receive actions/pages from fixtures via destructuring. Direct instantiation (`new LoginPage(page)`) inside a test is forbidden.
 
**Correct:**
 
```ts
import { test, expect } from '../fixtures/auth.fixture';
 
test('user can log in with valid credentials', async ({ loginAction, dashboardPage }) => {
  await loginAction.loginAsStandardUser();
  await expect(dashboardPage.welcomeBanner).toBeVisible();
});
```
 
**Forbidden:**
 
```ts
test('login', async ({ page }) => {
  const login = new LoginPage(page);            // ❌ direct instantiation
  await page.fill('#email', 'test@test.com');   // ❌ raw page in test
  await page.click('button[type=submit]');      // ❌ raw selector in test
});
```
 
---
 
## Rule 5 — Test Data
 
- All test inputs MUST come from `test-data/` (JSON, TS objects, or factories).
- Specs and actions MUST NOT contain hardcoded emails, passwords, product names, IDs, URLs, or copy strings.
- Sensitive data MUST come from environment variables loaded via `core/config`.
### Factory Pattern (REQUIRED for shared QA environments)
 
Any test data field that must be unique across test runs (framework names, user emails, report titles, etc.) MUST use a factory function with a timestamp suffix, not a static constant. Static constants cause duplicate-value failures on re-run in shared environments.
 
```ts
// ✅ Correct — unique per run
export function createFrameworkData(runId?: string): FrameworkData {
  const suffix = runId ?? String(Date.now()).slice(-8);
  return {
    name: `ESG-Framework-${suffix}`,
    code: `ESG-${suffix.slice(-4)}`,
    description: 'Automation test framework',
  };
}
 
// ❌ Wrong — collides on second run in shared environment
export const frameworkData = {
  name: 'ESG-Framework-2024',  // fails if this already exists
};
```

### Boundary Factories
Every feature's test-data file MUST export boundary helpers alongside the standard factory:
```ts
// test-data/framework/framework.data.ts
export const createFrameworkData = (overrides = {}) => ({ ...defaults, ...overrides });

// Boundary helpers — one export per constrained field
export const frameworkNameAtMax     = () => 'A'.repeat(50);   // on-boundary ✅
export const frameworkNameOverMax   = () => 'A'.repeat(51);   // off-boundary ❌
export const frameworkCodeAtMax     = () => 'B'.repeat(20);   // on-boundary ✅
export const frameworkCodeOverMax   = () => 'B'.repeat(21);   // off-boundary ❌
export const invalidEmail           = () => 'notanemail';
export const validUrl               = () => 'https://example.com';
export const invalidUrl             = () => 'not-a-url';
export const whitespaceOnly         = () => '   ';
```
Never hardcode boundary strings directly in spec files — always call helpers.

---
 
## Rule 6 — Environment & Configuration
 
- URLs, base hosts, API endpoints, credentials, and feature flags MUST resolve through `core/config` (which reads `.env` / `process.env`).
- `playwright.config.ts` MUST read `baseURL` from config — never hardcoded.
- No `if (env === 'staging')` branches inside actions or page objects. Configuration is injected, not switched on.
---
 
## Rule 7 — Naming Conventions (Strict)
 
| Artifact          | Pattern                                                | Example                                    |
| ----------------- | ------------------------------------------------------ | ------------------------------------------ |
| Page Object file  | `*Page.ts`                                           | `CheckoutPage.ts`                        |
| Page Object class | `*Page`                                              | `class CheckoutPage`                     |
| Action file       | `*Action.ts`                                         | `CheckoutAction.ts`                      |
| Action class      | `*Action`                                            | `class CheckoutAction`                   |
| Test file         | `*.spec.ts`                                          | `checkout.spec.ts`                       |
| Fixture file      | `*.fixture.ts`                                       | `checkout.fixture.ts`                    |
| Util file         | `kebab-case.ts`                                      | `date-helpers.ts`                        |
| Test data file    | `kebab-case.json/ts`                                 | `users.json`                             |
| Method names      | `verb + noun`, camelCase                             | `submitOrder()`, `getOrderTotal()`     |
| Locator fields    | `private readonly` + camelCase + element type suffix | `private readonly submitButton: Locator` |
 
---
 
## Rule 8 — Locator & Assertion Strategy
 
### Locators (in Page Objects only)
 
**Priority order:**
 
1. `getByRole` (most resilient — tied to accessible semantics)
2. `getByTestId` (requires `data-testid` on element)
3. `getByLabel` (best for form fields with labels)
4. `getByPlaceholder` (fallback for unlabelled inputs)
5. `getByText` / `filter({ hasText })` (for buttons with visible text)
6. CSS attribute selectors: `[id="x"]`, `[name="x"]`, `[placeholder="x"]`
7. XPath (last resort — only when CSS/role approaches are insufficient)
**Always `private readonly` and typed `Locator`.**
**One locator field per UI element — no inline `page.locator(...)` inside methods.**
 
### Multi-Strategy Locator Documentation (REQUIRED)
 
After live browser reconnaissance, document ALL captured strategies for each element in a JSDoc block above the locator field. This allows any strategy to be swapped in if one breaks, without hunting for the selector.
 
```ts
/**
 * Framework Name input field.
 *
 * Captured locators (live-verified YYYY-MM-DD):
 *   id          : framework-name-input
 *   placeholder : "Enter Framework Name"
 *   label text  : "Framework Name *"
 *   label for   : framework-name-input
 *   XPath       : //*[@id="framework-name-input"]
 *               | //input[@placeholder='Enter Framework Name']
 *   Playwright  : page.locator('input#framework-name-input')          ← primary
 *               | page.locator('input[placeholder="Enter Framework Name"]')
 *               | page.getByLabel('Framework Name', { exact: false })
 */
private readonly frameworkNameInput: Locator;
```
 
### Assertions (in Tests only)
 
- Use Playwright web-first assertions (`await expect(locator).toBeVisible()`).
- No `expect` calls inside page objects.
- Exception: actions MAY contain a `verify*` method that wraps assertions, used when a workflow's success is part of the workflow itself.
---
 
## Rule 9 — Code Quality Standards
 
- TypeScript strict mode; no `any` unless justified with a comment.
- All `async` functions awaited.
- **No `page.waitForTimeout(ms)`** for synchronization — use web-first assertions or `waitForURL()` (see table below).
- No `console.log` in committed code; use the framework logger from `core/`.
- Every public method has a one-line JSDoc when the name isn't self-evident.
- All Action methods MUST be wrapped in `test.step()` for Playwright HTML report traceability.
### Approved Alternatives to `waitForTimeout`
 
| Instead of…                             | Use…                                                         | Why                                       |
| ---------------------------------------- | ------------------------------------------------------------- | ----------------------------------------- |
| `waitForTimeout(3000)` after click     | `await expect(locator).toBeVisible()`                       | Web-first; retries until timeout          |
| `waitForTimeout(2000)` after navigate  | `await page.waitForURL(/pattern/, { timeout })`             | Resolves as soon as URL matches           |
| `waitForTimeout(1000)` after tab click | `await page.waitForURL(/\?selectedTab=X/, { timeout })`     | URL update is the reliable signal         |
| `waitForTimeout(5000)` after form save | `await page.waitForURL(/\/list-path\/?$/, { timeout })`     | Redirect is the reliable post-save signal |
| `waitForTimeout(2000)` for toast       | `await toastLocator.waitFor({ state: 'visible', timeout })` | Element visibility is the reliable signal |
 
---
 
## Rule 10 — Anti-Patterns (Auto-Reject)
 
If any of these appear in generated output, Claude MUST regenerate:
 
| Anti-pattern                                                 | Why it fails                              | Correction                                |
| ------------------------------------------------------------ | ----------------------------------------- | ----------------------------------------- |
| `page.click('#btn')` inside a test                         | bypasses page object                      | move to Page Object method                |
| `await this.page.locator('.foo').click()` inside an Action | locator outside Page Object               | add method to Page Object, call it        |
| `expect(...)` inside a Page Object                         | assertion outside test                    | move to spec or `verify*` action method |
| Hardcoded `'user@test.com'` in spec                        | data not centralized                      | move to `test-data/`                    |
| `new LoginPage(page)` inside a test                        | bypasses fixture                          | inject via fixture                        |
| `process.env.X` in Page Object                             | env coupling                              | resolve in `core/config`, inject        |
| Duplicate `LoginPage` / `LoginAction`                    | reuse violation                           | reuse existing                            |
| `page.waitForTimeout(3000)`                                | flaky, slow                               | use web-first assertion or `waitForURL` |
| Util function that takes `Page`                            | breaks util purity                        | move to Page Object or Action             |
| Static test data for unique-per-run fields                   | collides on re-run in shared QA env       | use factory function with suffix          |
| Locators written without live DOM verification               | brittle — spec selectors are often wrong | run Phase B recon first (Rule 0)          |
 
---
 
## Rule 11 — Canonical Templates
 
When CREATE is genuinely required, follow these shapes:
 
### Page Object (with multi-strategy locator documentation)
 
```ts
// page_objects/CheckoutPage.ts
import { Page, Locator } from '@playwright/test';
import { BasePage } from '../core/base/BasePage';
 
export class CheckoutPage extends BasePage {
  /**
   * Email input on the checkout form.
   *
   * Captured locators (live-verified YYYY-MM-DD):
   *   id          : checkout-email
   *   name        : email
   *   placeholder : "Enter your email"
   *   label text  : "Email Address"
   *   XPath       : //*[@id="checkout-email"]
   *               | //input[@name="email"]
   *   Playwright  : page.locator('input#checkout-email')    ← primary
   *               | page.getByLabel('Email Address')
   *               | page.locator('input[name="email"]')
   */
  private readonly emailInput: Locator;
 
  /**
   * "Continue" submit button.
   *
   *   tag         : button
   *   type        : submit
   *   text exact  : "Continue"
   *   XPath       : //button[normalize-space()='Continue']
   *   Playwright  : page.getByRole('button', { name: 'Continue' })  ← primary
   *               | page.locator('button[type="submit"]')
   */
  private readonly continueButton: Locator;
 
  constructor(page: Page) {
    super(page);
    this.emailInput     = page.locator('input#checkout-email');
    this.continueButton = page.getByRole('button', { name: 'Continue' });
  }
 
  async fillEmail(email: string): Promise<void> {
    await this.emailInput.fill(email);
  }
 
  async submitContinue(): Promise<void> {
    await this.continueButton.click();
  }
 
  /** Wait for the page to redirect to the shipping step after form submission. */
  async waitForShippingStep(): Promise<void> {
    await this.page.waitForURL(/\/checkout\/shipping/, { timeout: 10_000 });
  }
}
```
 
### Action (with `test.step` wrapping — REQUIRED)
 
```ts
// actions/CheckoutAction.ts
import { test, expect } from '@playwright/test';
import { CheckoutPage } from '../page_objects/CheckoutPage';
import { CartPage } from '../page_objects/CartPage';
import { CheckoutData } from '../test-data/checkout-data';
import { Logger } from '../core/logger/Logger';
 
export class CheckoutAction {
  constructor(
    private readonly cartPage: CartPage,
    private readonly checkoutPage: CheckoutPage,
  ) {}
 
  /** Complete the guest checkout email step and verify redirect to shipping. */
  async checkoutAsGuest(data: CheckoutData): Promise<void> {
    await test.step('Proceed to checkout from cart', async () => {
      Logger.info('Proceeding to checkout');
      await this.cartPage.proceedToCheckout();
    });
 
    await test.step(`Fill checkout email: ${data.email}`, async () => {
      await this.checkoutPage.fillEmail(data.email);
      await this.checkoutPage.submitContinue();
    });
 
    await test.step('Verify redirect to shipping step', async () => {
      await this.checkoutPage.waitForShippingStep();
      Logger.info('Checkout email step completed ✓');
    });
  }
}
```
 
### Fixture (single)
 
```ts
// fixtures/checkout.fixture.ts
import { test as base } from '@playwright/test';
import { CartPage } from '../page_objects/CartPage';
import { CheckoutPage } from '../page_objects/CheckoutPage';
import { CheckoutAction } from '../actions/CheckoutAction';
 
type CheckoutFixtures = {
  cartPage: CartPage;
  checkoutPage: CheckoutPage;
  checkoutAction: CheckoutAction;
};
 
export const test = base.extend<CheckoutFixtures>({
  cartPage:       async ({ page }, use) => use(new CartPage(page)),
  checkoutPage:   async ({ page }, use) => use(new CheckoutPage(page)),
  checkoutAction: async ({ cartPage, checkoutPage }, use) =>
    use(new CheckoutAction(cartPage, checkoutPage)),
});
 
export { expect } from '@playwright/test';
```
 
### Fixture Chain (for modules that need login — REQUIRED PATTERN)
 
In most frameworks, feature fixtures must extend the auth fixture chain, not the Playwright base. This ensures `loginAction` is always available in `beforeEach` without re-wiring it per feature.
 
```
page.fixture.ts         → injects: loginPage
    ↓ extends
test.fixture.ts         → injects: loginAction
    ↓ extends
feature.fixture.ts      → injects: featurePage, featureAction
```
 
```ts
// fixtures/feature.fixture.ts
import { test as base } from './test.fixture';   // ← extend the chain, NOT @playwright/test
import { FeaturePage }   from '../page_objects/feature/FeaturePage';
import { FeatureAction } from '../actions/feature/FeatureAction';
 
type FeatureFixtures = {
  featurePage: FeaturePage;
  featureAction: FeatureAction;
};
 
export const test = base.extend<FeatureFixtures>({
  featurePage:   async ({ page }, use) => use(new FeaturePage(page)),
  featureAction: async ({ featurePage }, use) => use(new FeatureAction(featurePage)),
});
 
export { expect } from '@playwright/test';
```
 
```ts
// tests/feature/feature.spec.ts
import { test, expect } from '../../fixtures/feature.fixture';
import { createFeatureData } from '../../test-data/feature/feature-data';
 
test.describe('Feature Module', () => {
  test.beforeEach(async ({ loginAction, featureAction }) => {
    await loginAction.loginAndWaitForLoad();     // from test.fixture chain
    await featureAction.navigateToFeatureList(); // from feature.fixture
  });
 
  test('TC-XXX: should do something', async ({ featureAction, page }) => {
    const data = createFeatureData(); // factory — unique per run
    await featureAction.performWorkflow(data);
    await expect(page).toHaveURL(/\/feature/);
  });
});
```
 
### Test
 
```ts
// tests/checkout.spec.ts
import { test, expect } from '../fixtures/checkout.fixture';
import { createCheckoutData } from '../test-data/checkout-data';
 
test('guest can proceed through checkout email step', async ({
  checkoutAction,
  checkoutPage,
}) => {
  const data = createCheckoutData(); // ← factory, not static constant
  await checkoutAction.checkoutAsGuest(data);
  await expect(checkoutPage.shippingHeading).toBeVisible();
});
```
 
---
 
## Rule 12 — Pre-Output Validation Checklist
 
Before returning code, Claude MUST internally answer YES to all of these. Any NO → regenerate.
 
1. Did I read `core/` subfolders (base, config, constants, logger) as the foundation? Did I read login files only if this test requires authentication? Did I avoid reading any other existing scripts (they are independent and irrelevant)?
2. Did I run Phase B (live browser recon via recon utility, codegen, or DevTools) and verify all selectors against the real DOM?
3. Did I REUSE or EXTEND existing assets where possible instead of creating new ones?
4. Is every artifact in its correct folder?
5. Are tests free of locators, raw `page` calls, and `new` instantiations?
6. Are actions free of locators and assertions (except `verify*` methods)?
7. Are page objects free of business workflows and assertions?
8. Are utils free of `Page` references and statefulness?
9. Are all selectors verified against the live DOM with multi-strategy comments?
10. Are all data values pulled from `test-data/` using factory functions where uniqueness is required?
11. Are all env values pulled from `core/config`?
12. Do filenames and class names match Rule 7 patterns exactly?
13. Are all `async` paths awaited and free of `waitForTimeout`?
14. Are all multi-step Action methods wrapped in `test.step()`?
15. Does the fixture extend the existing chain (not re-create from `@playwright/test` base)?
16. For every input field in the spec, have I generated: max-length+1 ❌, max-length ✅, min-length ✅, min-length-1 ❌ test cases?
17. For email/URL fields, have I generated: valid format ✅, invalid format ❌, empty ❌ test cases?
18. For required fields, have I covered: whitespace-only ❌ (not just empty)?
19. Are all boundary values sourced from test-data factory helpers, not inline strings?
---
 
## Rule 13 — Suggestions Policy
 
If Claude wants to recommend improvements outside the user's request:
 
- Provide them in a separate section labeled **"Optional Suggestions"**.
- Never silently modify the requested implementation.
- Never refactor unrelated existing code without permission.
---
 
## Rule 14 — Conflict Handling
 
If the user's request conflicts with these rules (e.g., "just put the locator in the test"), Claude MUST:
 
1. State the violation clearly.
2. Provide the compliant implementation.
3. Offer the non-compliant version only if the user explicitly insists after being warned, and mark it `// NOTE: deviates from framework standard`.
Claude MUST NOT silently comply with anti-patterns.
 
---
 
## Rule 15 — Extensibility Requirements
 
Generated code MUST be compatible with:
 
- Parallel execution (no shared mutable module state).
- CI/CD (no interactive prompts, no machine-specific paths).
- Reporting (use Playwright's `test.step` for multi-step actions — required, not optional).
- Future API-layer integration (keep UI and API actions separable).
---
 
## Rule 16 — Spec-vs-Reality Discrepancy Handling
 
Test case specs (Excel, CSV, Jira, Confluence) are written at design time. The live application frequently differs. When a discrepancy is found during live browser reconnaissance:
 
1. **Never write code that matches the spec but fails the live app.** Automation tests the real application, not the document.
2. **Document the discrepancy** in a `⚠ Live-behaviour note:` comment in BOTH the page object and the test file.
3. **Test what the app actually does**, and note what the spec expected.
4. **Flag it as a potential bug** in the test name or a comment if the discrepancy represents incorrect application behaviour.
```ts
/**
 * ⚠ Live-behaviour note (verified YYYY-MM-DD, user: user@example.com):
 *   Spec expected : Type=System, Status=Active, Visibility=Global
 *   Actual result : Type=Custom, Status=Draft (auto-assigned from org role)
 *
 * The test verifies successful creation and correct grid presence (Draft tab).
 * Type=System / Status=Active require a Back Office Admin account with
 * elevated org-role permissions not held by the automation user.
 */
```
 
---
 
## Rule 17 : Constrain
 
•   Ensure junior developer–friendly(1+ experience) readability.
•   While you have deep architectural expertise, you MUST prioritize simplicity, readability, and maintainability for junior developers (1+ years experience) over architectural sophistication.
•   If the requirement is clear and unambiguous, proceed without asking for clarification.
•   If any required information is missing or ambiguous, explicitly request clarification instead of guessing or making assumptions.
•   If the solution is straightforward with no significant trade-offs, proceed with the simplest approach without asking for approval.
•   Prefer simple, readable, and maintainable solutions over complex or “clever” designs.
•   Avoid over-engineering, unnecessary abstractions, or complex design patterns unless absolutely required by the requirement.
•   Any developer with 1+ years of experience should be able to understand and modify the code without additional explanation.
•   Keep logic as straightforward and linear as possible.

---

## Final Enforcement Clause
 
This skill is **strict by design**. Clean architecture, scalability, and reuse beat short-term convenience every time. When in doubt:
 
> **Reuse first. Extend second. Create last. Never duplicate.**
> **Browser first. Spec second. Never assume selectors.**