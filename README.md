# Playwright AI Framework

Production-style AI-powered Playwright automation framework that converts manual Excel flows and JSON payloads into normalized scenario JSON, then executes each scenario through a Webwright-style hybrid step runner. The runner scans the live UI at every step, sends the current step and locator candidates to the configured LLM, validates the LLM-selected locator, executes the action, verifies the UI effect, captures artifacts, attempts one repair on failure, and writes JSON/HTML reports with estimated LLM token usage.

## Requirements

- Node.js 20 or newer
- A reachable application URL
- OpenAI API key
- Playwright browser dependencies

## Setup

```bash
npm install
npx playwright install
cp .env.example .env
```

Fill `.env`:

```bash
OPENAI_API_KEY=your-key
OPENAI_MODEL=gpt-4.1-mini
LLM_PROVIDER=openai
ACTION_DECISION_MODE=llm_first
LOG_LLM_IO=true
LLM_IO_MAX_CHARS=20000
WEBSITE_URL=https://your-app.example.com
LOGIN_EMAIL=your-login
LOGIN_PASSWORD=your-password
HEADLESS=false
SLOW_MO=100

# Optional path overrides
INPUT_FLOW_PATH=input/test_flow.xlsx
INPUT_DATA_PATH=input/test_data.json
SCENARIO_OUTPUT_DIR=scenarios
DYNAMIC_RECON_OUTPUT_DIR=dynamic-recon
GENERATED_TEST_OUTPUT_DIR=tests/generated
GENERATED_TEST_QUARANTINE_DIR=generated-quarantine
REPORT_OUTPUT_DIR=reports
GENERATION_REPORT_PATH=reports/generation-result.json

# Optional stable login locators, preferably frontend data-testid selectors
LOGIN_EMAIL_SELECTOR=[data-testid="login-email"]
LOGIN_PASSWORD_SELECTOR=[data-testid="login-password"]
LOGIN_SUBMIT_SELECTOR=[data-testid="login-submit"]

# Disabled by default. Enable only when no stable locator exists.
ALLOW_XPATH_LOCATORS=false
ALLOW_POSITIONAL_LOCATORS=false
```

Never commit `.env`.

## Inputs

Place the manual flow in `input/test_flow.xlsx`. Flexible Excel headers are supported:

- `scenario_id` or `Scenario ID`
- `module` or `Module`
- `action` or `Action`
- `step_no` or `Step No`
- `instruction`, `Instruction`, or `Step`
- `expected_result` or `Expected Result`

Place payloads in `input/test_data.json`:

```json
[
  {
    "scenario_id": "TC-UM-001",
    "payload": {
      "First Name": "Riya",
      "Last Name": "Sharma",
      "Email Address": "riya.sharma@example.test",
      "Role": "Executive",
      "Status": "Pending",
      "Password": "{{TEST_USER_PASSWORD}}"
    }
  }
]
```

Payload values may use env placeholders like `{{TEST_USER_PASSWORD}}` or `${TEST_USER_PASSWORD}`. Password-like payload keys are redacted before normalized scenario files are written.

## Commands

Run the seed login test:

```bash
npm run test:seed
```

Run the dynamic step-runner pipeline:

```bash
npm run build:scenarios
npm run run:webwright
```

Run the full pipeline:

```bash
npm run pipeline
```

The older static generation flow is still available for comparison:

```bash
npm run pipeline:static
```

Static generation attempts every scenario independently. If one scenario cannot produce a safe generated test, its failure is written to `reports/generation-result.json`, any older generated script for that scenario is moved to `generated-quarantine/`, and generation continues for the remaining scenarios. Validation, generated-test execution, and healing use only the successful files listed in the latest generation report.

## How The Pipeline Works

1. `build:scenarios` reads the configured Excel/JSON input paths, matches rows by `scenario_id`, normalizes manual steps, and writes clean scenario JSON files to the configured scenario output folder.
2. `run:webwright` opens one live Playwright browser session per scenario and logs in with `.env` credentials.
3. For every normalized step, the runner captures the current page state, runs fresh DOM/accessibility recon, asks the LLM to decide the action/locator, validates the selected locator, executes it, waits for UI stability, verifies the effect, and captures the next page state.
4. Recon runs inside the step loop, not only once at the beginning, so modals, dropdowns, and newly rendered controls are discovered only after the earlier steps create them.
5. If a step fails, the runner records the error, screenshot, DOM/accessibility snapshot, locator decision, and failure reason. It then attempts one repair using a fresh snapshot.
6. If repair succeeds, the scenario continues and marks the step as `repaired`. If repair fails, the scenario stops with a step-wise failure report.
7. Reports, snapshots, and screenshots are written to the configured report and recon output folders.
8. The report includes LLM call count and estimated token usage.

## Webwright-Style Hybrid Runner Behavior

The runner is state-based, not a single page scan. It follows the actual user journey:

- Open login page, scan it.
- Log in, scan dashboard.
- For each step, capture `before` state.
- Run fresh DOM and accessibility recon for the current page state.
- Resolve deterministic locator candidates and validate safety.
- In the current default mode, `ACTION_DECISION_MODE=llm_first`, send every executable step to the LLM.
- The LLM decides which locator/action to use from the current screen.
- Deterministic candidates are still built, but they are used as safe options for the LLM instead of being auto-executed first.
- To switch back to older deterministic-first behavior, set `ACTION_DECISION_MODE=deterministic_first`.
- Execute the selected Playwright action.
- Wait until the UI is stable.
- Capture `after` state.
- Verify the effect.
- On failure, capture screenshot and attempt one repair from a fresh page snapshot.
- Record estimated LLM tokens in the JSON/HTML report.

## OpenAI Usage

In the current dynamic flow, LLM usage is first-class: every executable step goes to the LLM by default so the LLM decides which locator/action to use from the current screen. Safety validation still runs before execution.

To see exactly what the framework sends to the LLM and what the LLM returns in the terminal, keep:

```bash
LOG_LLM_IO=true
LLM_IO_MAX_CHARS=20000
```

The terminal output is redacted before printing. API keys, login email, login password, bearer tokens, JWTs, and password/token-like payload fields are masked. Increase `LLM_IO_MAX_CHARS` only when you need a larger prompt/response preview.

The older static generation flow uses OpenAI in three places:

- Planner: scenario JSON to Markdown test plan.
- Generator: scenario, plan, and recon snapshots to Playwright TypeScript tests.
- Healer: failed run output plus recon snapshots to repaired tests.

The framework does not send login passwords to OpenAI. Generated tests must use `process.env.LOGIN_PASSWORD`.

## Security Rules

- Never commit `.env`.
- Never print `OPENAI_API_KEY`.
- Never print `LOGIN_PASSWORD`.
- Never send `LOGIN_PASSWORD` to OpenAI.
- Scenario files redact password-like payload keys.
- DOM recon never collects password input values.
- Recon does not collect cookies, localStorage tokens, JWTs, auth headers, or session data.

## Limitations

- The first version uses heuristic recon instead of a full autonomous browser agent.
- Complex drag/drop, canvas, multi-window, or highly custom widgets may need manual improvement.
- Generated tests should be reviewed before production use.
- `data-test`, `data-cy`, and `data-qa` are treated as strong CSS locator candidates; Playwright `getByTestId` is used for `data-testid`.
