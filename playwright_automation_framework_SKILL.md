---
name: playwright-automation-framework-strict
description: Use this skill whenever the user asks to write, generate, scaffold, extend, or refactor Playwright automation code in this layered TypeScript framework. Applies to work that creates or updates files under tests/, fixtures/, core/, page_objects/, actions/, utils/, test-data/, or api/. This skill enforces targeted discovery, live UI verification, strict layer separation, reuse of existing framework assets, and environment-driven execution. Do not use it for non-Playwright frameworks, unit tests, API-only suites, or disposable scripts outside the framework.
---

# Playwright Automation Framework — Practical Strict Mode

This skill is for generating maintainable Playwright automation inside this repository.

It is strict about:
- using the existing framework shape
- verifying the live UI before finalizing locators
- reusing relevant existing code before creating new files
- keeping test data and configuration out of spec files

It is intentionally **not** strict in ways that fight the real project structure.

## Core Principles

1. **Reuse before create**
   - Reuse relevant existing `page_objects/`, `actions/`, `fixtures/`, and `test-data/` when they match the same screen or flow.
   - Extend an existing file if the screen/module is the same.
   - Create a new file only when the feature is genuinely new.

2. **Ground truth comes from the live UI**
   - Specs, Excel sheets, and old automation can be wrong.
   - Verify locators and dynamic behavior against the real application before locking code.

3. **Keep layers clean**
   - Tests orchestrate and assert.
   - Actions express business flow.
   - Page objects hold locators and screen-level interactions.
   - Fixtures wire dependencies.
   - Test data holds input values and factories.

4. **Configuration is runtime-driven**
   - URL, username, password, timeout, and environment-specific values come from `.env` and `core/config`.
   - Runtime env values override `config/*.json` values when both exist.

5. **Prefer simple, junior-friendly code**
   - Use the simplest correct design.
   - Avoid clever abstractions unless the repetition is real and recurring.

---

## Rule 0 — Discovery Before Writing Code

Do not write code until both discovery phases are complete.

### Phase A — Codebase Discovery

Always inspect the shared foundation:
- `core/base/`
- `core/config/`
- `core/logger/`
- `config/`
- `.env` when runtime behavior matters

Inspect login files only if authentication is required:
- `page_objects/auth/LoginPage.ts`
- `actions/auth/LoginAction.ts`
- relevant auth fixtures if they exist

Inspect **relevant existing feature files** when deciding whether to reuse or extend:
- same module
- same screen
- same business flow
- same fixture chain

Do **not** blindly scan unrelated modules.

### Phase A — Reuse Decision

For every requested artifact, decide in this order:

1. **Reuse** existing file as-is
2. **Extend** existing file
3. **Create** new file

Use this rule:

- Same screen -> same Page Object
- Same business flow -> same Action
- Same fixture chain -> extend existing fixture chain
- Same data domain -> same `test-data` area

### Phase A — Import Safety

Before writing a file that imports another project file, verify that the imported file exists on disk.

If a dependency does not exist:
- create it first, then write the dependent file

Dependency order:

`test-data` / `page_objects` / `actions` -> `fixtures` -> `tests`

---

## Rule 1 — Live UI Recon Is Mandatory For UI Work

Before finalizing any Page Object locator, inspect the live application.

Recommended approaches:

1. **Playwright MCP inspection**
   - use it to open the page
   - inspect the accessibility tree / DOM behavior
   - verify dynamic flows such as dropdowns, drawers, tabs, and delayed rendering

2. **Local recon utility or codegen**
   - use when it is faster or when the flow is complex

3. **Manual browser + DevTools**
   - fallback only

### Recon Output Must Capture

For each important field or control, capture:
- visible label/text
- role
- placeholder
- `name`
- `id` if stable
- `data-testid` if available
- dynamic behavior after prior selections or clicks

For inputs, also capture when available:
- `type`
- `required`
- `maxlength` / `minlength`
- `pattern`
- `min` / `max`

### Dynamic UI Rule

If a field appears only after a prior step:
- perform that prior step first during recon
- then re-inspect
- then write the automation in the same order

Example:
- select `Pillar`
- verify `Topic` appears
- select `Topic`
- then verify next field

Never validate a later field before triggering the UI state that reveals it.

---

## Rule 2 — Folder Structure

Generated code must stay inside the existing framework structure:

| Folder | Purpose |
|---|---|
| `tests/` | Playwright specs |
| `fixtures/` | fixture composition and dependency injection |
| `core/` | base classes, config, logger, shared framework logic |
| `page_objects/` | screen-level locators and interactions |
| `actions/` | business workflows built on page objects |
| `utils/` | pure stateless helpers |
| `test-data/` | normalized scenario data, factories, static test inputs |
| `config/` | environment JSON |
| `api/` | API client abstraction if needed |
| `reports/` | generated artifacts only |

No new top-level folders unless the user explicitly requests a framework restructure.

---

## Rule 3 — Layer Responsibilities

### Tests

Allowed:
- import fixtures
- call actions and page helpers exposed by fixtures
- perform assertions
- manage scenario sequencing and dependency chaining

Forbidden:
- raw locators
- direct `page.click`, `page.fill`, `page.locator` in normal feature tests
- large business workflows
- hardcoded credentials or URLs

### Actions

Allowed:
- call page object methods
- model multi-step business flows
- wrap important multi-step operations in `test.step()`
- use logger

Forbidden:
- raw selectors
- direct Playwright locator construction
- environment lookups
- hardcoded business data

### Page Objects

Allowed:
- define locators
- perform screen-level interaction methods
- perform page-level navigation for that screen/module
- expose presence checks and simple read methods

Forbidden:
- cross-module business workflows
- assertions with `expect(...)`
- awareness of scenario documents or large payload objects

### Fixtures

Allowed:
- instantiate pages and actions
- extend the existing fixture chain
- provide shared setup/teardown only when appropriate

Forbidden:
- assertions
- test case logic

### Utils

Allowed:
- pure helpers

Forbidden:
- anything that depends on Playwright `Page`
- feature-specific workflow logic

---

## Rule 4 — Fixture Chain

Use the existing chain instead of rebuilding from `@playwright/test` for every feature.

Preferred flow:

`page.fixture.ts` -> `test.fixture.ts` -> feature-specific fixtures if needed

If the repo already exposes auth and shared actions through `fixtures/test.fixture.ts`, build on that unless there is a strong reason not to.

---

## Rule 5 — Data and Scenario Handling

All meaningful test input must come from:
- `input/` raw files
- normalized files in `test-data/`
- factories/helpers in `test-data/`

Do not hardcode in the spec:
- usernames
- passwords
- URLs
- entity names expected to be unique per run
- long payload values copied from Excel/JSON

### Unique Data Rule

If the environment is shared and values must be unique:
- use factory helpers or timestamp-suffixed generators

Example categories:
- user email
- framework name
- pillar/topic/disclosure name
- report title

### Validation Expansion Rule

Do **not** automatically generate every possible boundary test for every request.

Instead:
- if the input explicitly describes validation scenarios, generate them
- if the request is happy-path flow automation, keep the suite focused on happy-path behavior
- add boundary helpers in `test-data/` when the field constraints matter

---

## Rule 6 — Configuration

Environment values must resolve through `core/config`.

Required behavior:
- `.env` and runtime environment variables are the highest priority
- `config/${ENV}.json` is fallback configuration
- specs, actions, and page objects must not hardcode URL or credentials

Preferred resolution order:

1. `process.env`
2. `.env` loaded into runtime env
3. `config/${ENV}.json`
4. sensible code default only when non-sensitive

---

## Rule 7 — Locator Strategy

Use this priority order unless the live UI shows a better stable choice:

1. `getByTestId`
2. `getByRole`
3. `getByLabel`
4. `getByPlaceholder`
5. scoped `getByText` / `filter({ hasText })`
6. stable CSS attribute selector
7. XPath as last resort

Never use:
- random class names
- dynamic IDs
- brittle full XPath
- unscoped `getByText` for dropdown options
- `nth()` unless there is no better stable handle

### Dropdown Rule

For dropdowns:
1. click/open the dropdown first
2. inspect the visible popup/listbox/options
3. select from the visible dropdown context
4. avoid global text selection when a scoped option locator is possible

### Locator Documentation

Page Objects should preserve enough context to maintain locators easily.

Use either:
- clear locator names
- short comments/JSDoc for tricky dynamic elements

Do not force huge repeated comment blocks on every simple locator.

---

## Rule 8 — Waiting and Stability

Prefer:
- `expect(locator).toBeVisible()`
- `expect(locator).toHaveText()`
- `page.waitForURL()`
- `locator.waitFor()`
- explicit post-action UI signals

Avoid `waitForTimeout`.

A short explicit timeout may be used only when:
- the UI provides no reliable observable signal
- the reason is clear and localized
- a better signal was attempted but is not available

If a route is flaky because the SPA renders late:
- prefer a small retry around navigation plus a stable primary action
- do not hide real product failures with overly broad retries

---

## Rule 9 — Assertions

Assertions belong in tests.

Allowed exception:
- an action may contain a clearly named `verify*` helper when the verification is part of the business flow and improves readability

Page Objects must not contain `expect(...)`.

---

## Rule 10 — Spec vs Reality

When the input document and the live UI differ:

1. automate the real application behavior
2. clearly report the mismatch
3. if needed, stop the scenario at the point the live UI no longer supports the documented flow

Examples:
- spec says a checkbox exists, UI has none
- input expects `Disclosure Code`, live form never renders it
- spec says field is editable, live app disables it

In those cases:
- do not fake the old flow
- do not hardcode assumptions
- report the mismatch in the result and, when helpful, in code comments

---

## Rule 11 — Anti-Patterns

Reject and regenerate if the output includes:

- raw locators inside tests
- raw locators inside actions
- `expect(...)` inside page objects
- hardcoded secrets or URLs
- duplicate auth/page/action classes for the same screen
- new files created without checking whether a relevant one already exists
- locators written without live verification
- `Page` passed into utils
- large duplicated logic across multiple page objects/actions

---

## Rule 12 — Minimal Output Checklist

Before finalizing generated automation, confirm:

1. shared `core/config/logger` patterns were checked
2. relevant existing module files were inspected for reuse
3. live UI recon was performed for the target screen
4. URL and credentials come from config/env only
5. tests do not contain raw page interactions for feature logic
6. actions do not contain locators
7. page objects do not contain assertions
8. data is sourced from `input/` or normalized `test-data/`
9. unique values use factories/helpers when needed
10. fixture chain follows the repo’s existing pattern
11. failure reasons distinguish locator/code issues from app/data issues

---

## Suggested Working Flow

For this repository, the normal implementation flow should be:

1. Read `input/`
2. Read `core/config/logger` and relevant auth/shared fixture files
3. Read relevant existing module files if they may be reused
4. Inspect the live UI with Playwright MCP or recon
5. Normalize scenario data into `test-data/`
6. Create or extend `page_objects/`
7. Create or extend `actions/`
8. Update fixtures only as needed
9. Create or extend spec file
10. Run Playwright tests
11. Repair locator/code issues
12. Report application/data mismatches clearly

---

## Final Principle

When in doubt:

> **Inspect the real UI, reuse the real framework, and keep the code simple.**
