# Playwright AI Framework

Production-style AI-powered Playwright automation framework that converts manual Excel flows and JSON payloads into scenario files, asks OpenAI to plan and generate tests, performs interactive state-based UI recon, validates locators, runs tests, heals failures, and writes JSON/HTML reports.

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
WEBSITE_URL=https://your-app.example.com
LOGIN_EMAIL=your-login
LOGIN_PASSWORD=your-password
HEADLESS=false
SLOW_MO=100
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
      "First Name": "Priya",
      "Last Name": "Sharma",
      "Email Address": "priya.sharma@piraiinfotech.com",
      "Role": "Executive",
      "Status": "Pending"
    }
  }
]
```

## Commands

Run the seed login test:

```bash
npm run test:seed
```

Run each pipeline stage:

```bash
npm run build:scenarios
npm run plan
npm run recon
npm run generate
npm run validate
npm run run:generated
npm run heal
npm run report
```

Run the full pipeline:

```bash
npm run pipeline
```

## How The Pipeline Works

1. `build:scenarios` reads `input/test_flow.xlsx` and `input/test_data.json`, matches rows by `scenario_id`, and writes clean scenario JSON files to `scenarios/`.
2. `plan` sends each sanitized scenario to OpenAI and writes Markdown plans to `specs/`.
3. `recon` opens the app with Playwright, captures login and dashboard states, then follows scenario steps using deterministic heuristics.
4. Recon captures every meaningful UI state: before and after actions, modal/form states, and opened dropdown states such as Role or Status.
5. `generate` sends scenario, plan, payload, and recon snapshots to OpenAI and writes tests to `tests/generated/`.
6. `validate` performs static locator risk checks and writes `reports/locator-validation.json`.
7. `run:generated` runs `tests/generated` with Playwright and writes `reports/run-result.json`.
8. `heal` asks OpenAI to repair only locator, wait, and assertion failures, then writes repaired tests to `tests/healed/`.
9. `report` writes `reports/result.json` and `reports/result.html`.

## Recon Behavior

Recon is state-based, not a single page scan. It follows the actual user journey:

- Open login page, scan it.
- Log in, scan dashboard.
- Navigate or click based on scenario steps.
- Capture state before and after each action.
- Open dropdowns mentioned in steps and capture available options.
- If an action cannot be performed, it still writes a snapshot with `action_error` and continues where possible.

The first version intentionally uses heuristic actions such as:

- `navigate to X` or `go to X`
- `click X`
- `add user`
- Role and Status dropdown opening
- Generic payload field filling when the step asks to fill or enter form data

## OpenAI Usage

OpenAI is used in three places:

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
