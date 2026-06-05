# Playwright AI Automation Framework

This project converts manual test cases and JSON test data into executable Playwright automation. It supports two flows:

- Dynamic pipeline: runs each scenario directly against the live application by scanning the current DOM at every step and choosing a safe action/locator.
- Static pipeline: creates TypeScript Playwright specs in `tests/generated/`, validates them, runs only successfully generated specs, heals failures, and writes a final report.

The dynamic pipeline is the main working flow for day-to-day automation. The static pipeline is useful when you need generated `.spec.ts` files that can be reviewed, committed, or reused.

## Requirements

- Node.js 20 or newer
- A reachable application URL
- Playwright browser dependencies
- OpenAI API key or Gemini API key
- Login credentials for the target application

## Setup

```bash
npm install
npx playwright install
cp .env.example .env
```

Fill `.env` with the values needed for your environment:

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=your-openai-key
OPENAI_MODEL=gpt-4.1-mini

# Or use Gemini
# LLM_PROVIDER=gemini
# GEMINI_API_KEY=your-gemini-key
# GEMINI_MODEL=gemini-2.5-flash

ACTION_DECISION_MODE=llm_first
WEBSITE_URL=https://your-app-url.example.com
LOGIN_EMAIL=your-login-email
LOGIN_PASSWORD=your-login-password
HEADLESS=false
SLOW_MO=100

LOG_LLM_IO=true
LLM_IO_MAX_CHARS=20000

INPUT_FLOW_PATH=input/test_flow.xlsx
INPUT_DATA_PATH=input/test_data.json
SCENARIO_OUTPUT_DIR=scenarios
SPEC_OUTPUT_DIR=specs
SCENARIO_ACTION_OUTPUT_DIR=scenario-actions
RECON_OUTPUT_DIR=recon
RECON_SUMMARY_OUTPUT_DIR=recon-summary
DYNAMIC_RECON_OUTPUT_DIR=dynamic-recon
GENERATED_TEST_OUTPUT_DIR=tests/generated
GENERATED_TEST_QUARANTINE_DIR=generated-quarantine
HEALED_TEST_OUTPUT_DIR=tests/healed
REPORT_OUTPUT_DIR=reports

ALLOW_XPATH_LOCATORS=false
ALLOW_POSITIONAL_LOCATORS=false
```

Do not commit `.env`.

## Input Files

The framework reads these default files:

- `input/test_flow.xlsx`: manual test cases and steps
- `input/test_data.json`: payload data matched by `scenario_id`

Supported Excel headers include:

- `scenario_id` or `Scenario ID`
- `module` or `Module`
- `action` or `Action`
- `step_no` or `Step No`
- `instruction`, `Instruction`, or `Step`
- `expected_result` or `Expected Result`

Example JSON:

```json
[
  {
    "scenario_id": "TC-UM-001",
    "record_id": "1e60cde8-f3ba-4b51-8f5d-e6c03aba5c7d",
    "data_strategy": "positive_valid_create",
    "edge_case_type": null,
    "payload": {
      "First Name": "Auto",
      "Last Name": "UserOne",
      "Email Address": "auto.user.one@example.com",
      "Role": "QA TEST MAGT",
      "Status": "Active"
    }
  }
]
```

Password-like payload fields are redacted before scenario JSON files are written.

## Recommended Step Writing

Write steps as user intent, not raw UI internals.

Use:

```text
Select the user
Click Reactivate
Click Deactivate
Enter Add comments
```

Avoid generic steps such as:

```text
Click Actions For User
```

The normalizer can convert `Select the user` into a row-specific action using payload identity such as email address. This is safer because the runner can target the correct row before opening the row action menu.

For state-changing cases, test data must match the expected current UI state:

- `Click Reactivate` needs a user that is currently suspended or inactive enough for the Reactivate option to be enabled.
- `Click Deactivate` needs a currently active user.
- Avoid reusing the same user record across multiple tests when one test changes that user's status.
- Role values in JSON must exactly match the values available in the UI dropdown.

## Common Commands

Build normalized scenario JSON:

```bash
npm run build:scenarios
```

Run the main dynamic pipeline:

```bash
npm run pipeline
```

Run dynamic execution after scenarios are already built:

```bash
npm run run:webwright
```

Run the seed login test:

```bash
npm run test:seed
```

Typecheck the project:

```bash
npm run typecheck
```

Run generator and normalizer tests:

```bash
npm run test:generator
npm run test:normalizer
```

## Generate TypeScript Test Files

To create generated Playwright `.spec.ts` files:

```bash
npm run build:scenarios
npm run plan
npm run extract:actions
npm run recon
npm run generate
```

Then validate and run only the generated files that succeeded:

```bash
npm run validate
npm run run:generated
```

Then heal and write the final static report:

```bash
npm run heal
npm run report
```

Or run the full static pipeline in one command:

```bash
npm run pipeline:static
```

## Dynamic Pipeline

`npm run pipeline` executes:

```bash
npm run build:scenarios && npm run run:webwright
```

What happens:

1. Excel and JSON input files are read.
2. Steps are normalized and scenario files are written to `scenarios/`.
3. The runner opens the application and logs in for each scenario.
4. For every step, the runner captures the current page state.
5. DOM and accessibility candidates are collected from the live UI.
6. The LLM chooses an action and locator from the current screen.
7. Locator safety checks run before execution.
8. Playwright executes the step.
9. The runner captures after-state evidence.
10. If a step fails, screenshot, DOM snapshot, decision details, and error details are saved.
11. One repair attempt is made from a fresh page snapshot.
12. The next scenario still runs even if the current scenario fails.

Dynamic reports are written to:

- `reports/dynamic-run-result.json`
- `reports/dynamic-run-result.html`
- `dynamic-recon/`

## Static Pipeline

`npm run pipeline:static` executes:

```bash
npm run build:scenarios &&
npm run plan &&
npm run extract:actions &&
npm run recon &&
npm run generate &&
npm run validate &&
npm run run:generated &&
npm run heal &&
npm run report
```

Static generation is independent per test case. One failed scenario does not stop the remaining scenarios.

Generation behavior:

- Each scenario runs inside its own `try/catch`.
- Generated code is validated before it is written.
- Successfully generated specs are written to `tests/generated/`.
- Failed scenarios are recorded in `reports/generation-result.json`.
- Older generated specs for failed scenarios are moved to `generated-quarantine/<scenario-id>/`.
- The pipeline continues if at least one scenario generated successfully.
- The pipeline fails only for fatal setup errors or when zero scenarios generate.

Example generation report:

```json
{
  "summary": {
    "total": 5,
    "generated": 4,
    "failed": 1
  },
  "scenarios": [
    {
      "scenario_id": "TC-UM-001",
      "status": "generated",
      "generated_file": "tests/generated/TC-UM-001.spec.ts"
    },
    {
      "scenario_id": "TC-UM-002",
      "status": "failed",
      "failed_stage": "deterministic-generation",
      "error": "Missing recon locator for select step: Select Role"
    }
  ]
}
```

Validation and `run:generated` use only successful files from the latest generation report. Final static reporting marks generation failures as `blocked` instead of incorrectly marking all existing generated files as passed.

Static reports are written to:

- `reports/generation-result.json`
- `reports/locator-validation.json`
- `reports/run-result.json`
- `reports/healing-result.json`
- `reports/result.json`
- `reports/result.html`

## Folder Structure

```text
input/
  test_flow.xlsx              Manual scenario steps
  test_data.json              Scenario payloads

scenarios/
  TC-*.json                   Normalized scenario files

specs/
  TC-*.md                     LLM-written static test plans

scenario-actions/
  *.json                      Actions extracted from generated plans

recon/
  TC-*/                       Static recon snapshots

dynamic-recon/
  TC-*/                       Dynamic run snapshots, screenshots, and decisions

tests/
  generated/                  Generated Playwright specs
  healed/                     Healed Playwright specs
  seed/                       Login seed test

generated-quarantine/
  TC-*/                       Older generated specs moved away after regeneration failure

reports/
  generation-result.json      Static generation success/failure report
  locator-validation.json     Locator validation warnings
  run-result.json             Generated Playwright run result
  result.json                 Final static report
  result.html                 Final static HTML report
  dynamic-run-result.json     Dynamic execution report
  dynamic-run-result.html     Dynamic execution HTML report
```

## Source File Purpose

Root files:

- `README.md`: Project guide, setup, pipeline commands, troubleshooting, and folder explanation.
- `package.json`: NPM scripts and dependency list.
- `package-lock.json`: Locked dependency versions for repeatable installs.
- `tsconfig.json`: TypeScript compiler settings.
- `playwright.config.ts`: Playwright test runner configuration.
- `.env.example`: Example environment variables. Copy it to `.env` and fill real values.
- `.env`: Local secrets and runtime configuration. Do not commit this file.
- `.gitignore`: Files and folders Git should ignore.

Input and documentation files:

- `input/test_flow.xlsx`: Manual test cases, steps, modules, actions, and expected results.
- `input/test_data.json`: Test payloads matched to scenarios by `scenario_id`.
- `input.zip`: Archived or shared input package.
- `generated.zip`: Archived generated output package.
- `docs/frontend-automation-readiness.md`: Frontend guidance for making the application easier to automate.

Core TypeScript files:

- `src/types.ts`: Shared TypeScript interfaces used across scenarios, recon, generation, running, and reports.
- `src/config/env.ts`: Reads `.env`, validates required values, and resolves framework paths.

Input parsing:

- `src/input/excelReader.ts`: Reads Excel test flow data.
- `src/input/jsonReader.ts`: Reads JSON payload data.

Scenario building:

- `src/scenario/scenarioBuilder.ts`: Combines Excel rows and JSON payloads into normalized scenario files.
- `src/scenario/stepNormalizer.ts`: Cleans manual steps, splits compound steps, and converts generic row actions into safer row-specific steps.
- `src/scenario/payloadIdentityResolver.ts`: Finds useful identity values from payloads, such as email or user name, for row targeting.
- `src/scenario/stepNormalizer.test.ts`: Tests the step normalizer rules.

Dynamic recon and action execution:

- `src/recon/actionParser.ts`: Parses natural-language steps into executable action intent.
- `src/recon/actionDecisionEngine.ts`: Chooses and executes the best action for each live UI step.
- `src/recon/accessibilityScanner.ts`: Reads accessibility information from the page.
- `src/recon/domScanner.ts`: Scans DOM elements and collects locator candidates.
- `src/recon/locatorCandidateBuilder.ts`: Builds possible Playwright locators from DOM/accessibility data.
- `src/recon/deterministicLocatorResolver.ts`: Finds safe deterministic locator matches before or alongside LLM decisions.
- `src/recon/llmActionAdvisor.ts`: Sends current step and candidates to the LLM for action selection.
- `src/recon/locatorSafetyValidator.ts`: Blocks unsafe locators such as broad, duplicate, positional, or disallowed XPath locators.
- `src/recon/pageStabilizer.ts`: Waits for UI stability after actions.
- `src/recon/stateSnapshotWriter.ts`: Writes screenshots, DOM snapshots, and action decision artifacts.
- `src/recon/reconDecisionTypes.ts`: Types for recon decisions and validation details.
- `src/recon/reconActionExtractor.ts`: Extracts successful action decisions from recon snapshots for static generation.
- `src/recon/interactiveRecon.ts`: Static recon command used before generating TypeScript specs.
- `src/recon/locatorValidator.ts`: Validates generated spec locators and writes locator warnings.

LLM planning, generation, and healing:

- `src/llm/llmClient.ts`: Selects the configured LLM provider.
- `src/llm/openaiClient.ts`: OpenAI client wrapper.
- `src/llm/geminiClient.ts`: Gemini client wrapper.
- `src/llm/planner.ts`: Converts scenario JSON into Markdown test plans.
- `src/llm/generatorPromptBuilder.ts`: Builds prompts and deterministic fallback code for generated Playwright specs.
- `src/llm/generator.ts`: Generates `.spec.ts` files independently per scenario and writes `reports/generation-result.json`.
- `src/llm/healer.ts`: Attempts to repair failed generated tests.
- `src/llm/generator.test.ts`: Tests generation behavior, including independent per-case generation.

Static generation support:

- `src/specs/mdActionExtractor.ts`: Extracts executable actions from Markdown plans.
- `src/generation/generationSelection.ts`: Selects only successfully generated files from the latest generation report.
- `src/utils/specImportPaths.ts`: Normalizes imports inside generated specs.

Runners and reports:

- `src/runner/dynamicScenarioRunner.ts`: Main dynamic/Webwright-style runner.
- `src/runner/playwrightRunner.ts`: Runs generated Playwright specs selected from the latest generation report.
- `src/reports/reportWriter.ts`: Writes final static JSON and HTML reports, including `blocked` generation failures.

Utilities:

- `src/utils/fileUtils.ts`: Shared file read/write, JSON, path, escaping, and safe filename helpers.
- `src/utils/logger.ts`: Simple framework logging helper.

## Reports And Status

Dynamic report status:

- `passed`: all scenario steps completed
- `failed`: a step failed and repair did not recover it
- `repaired`: a failed step recovered and scenario continued

Static final report status:

- `passed`: generated Playwright spec passed
- `failed`: generated Playwright spec ran and failed
- `blocked`: spec could not be generated safely
- `unknown`: report data was incomplete or the scenario was not included in the latest run

## Troubleshooting

If only some tests generate:

- Check `reports/generation-result.json`.
- Failed scenarios are expected to be `blocked`.
- Successful generated files can still validate and run.

If Reactivate or Deactivate fails:

- Check whether the menu option is disabled in the screenshot.
- Use test data where the user's current status allows the requested action.
- Do not use one user for multiple state-changing scenarios unless the test order intentionally prepares that state.

If Role selection fails:

- Confirm the JSON `Role` value exists exactly in the UI dropdown.
- Prefer stable frontend attributes on dropdown options.

If the wrong user row is selected:

- Use `Select the user` in the input step.
- Make sure payload includes a unique `Email Address` or another unique row identity.

If generated code is stale:

- Check `generated-quarantine/`.
- A stale file is moved there when regeneration for that scenario fails.

## Frontend Automation Standards

The application becomes much easier to automate when the frontend exposes stable, meaningful selectors:

- Add `data-testid` to important controls, forms, dialogs, row action buttons, menu items, and status badges.
- Use unique row identifiers such as email, user id, or record id in row markup.
- Keep accessible names clear and consistent.
- Do not rely only on visual position or duplicate button labels.
- Avoid disabled menu actions without visible state text explaining why the action is disabled.
- Keep toast, modal, validation, and error messages accessible to Playwright locators.

Good frontend structure reduces LLM uncertainty, locator flakiness, repair attempts, and false failures.

## Security Rules

- Never commit `.env`.
- Never print `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `LOGIN_PASSWORD`.
- Never send login passwords to the LLM.
- Scenario files redact password-like payload keys.
- DOM recon does not collect password input values.
- Recon must not collect cookies, localStorage tokens, JWTs, auth headers, or session data.

## Current Limitations

- Highly custom widgets may need frontend selector improvements.
- Drag and drop, canvas, multi-window flows, and complex virtualized tables may need extra implementation.
- Generated TypeScript tests should be reviewed before production use.
- The best results come from current dynamic recon. If UI state changes often, run dynamic first, then generate static specs from the latest recon.
