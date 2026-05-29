# Playwright AI Framework

Production-style AI-powered Playwright automation framework that converts manual Excel flows and JSON payloads into scenario files, asks a configured LLM provider (OpenAI or Gemini) to plan and generate tests, performs interactive state-based UI recon, validates locators, runs tests, heals failures, and writes JSON/HTML reports.

## Requirements

- Node.js 20 or newer
- A reachable application URL
- OpenAI or Gemini API key (based on provider)
- Playwright browser dependencies

## Setup

```bash
npm install
npx playwright install
cp .env.example .env
```

Fill `.env`:

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=your-openai-key
OPENAI_MODEL=gpt-4.1-mini
GEMINI_API_KEY=your-gemini-key
GEMINI_MODEL=gemini-2.5-flash
WEBSITE_URL=https://your-app.example.com
LOGIN_EMAIL=your-login
LOGIN_PASSWORD=your-password
HEADLESS=false
SLOW_MO=100
```

`WEBSITE_URL` must be the **full entry URL** (usually the login page). Recon and generated tests navigate to it directly — do not append `/login` in code or env.

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
      "Email Address": "Riya.sharma@piraiinfotech.com",
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
2. `plan` sends each sanitized scenario to the configured LLM provider and writes Markdown plans to `specs/`.
3. `recon` opens the app with Playwright, captures login and dashboard states, then follows scenario steps using deterministic heuristics.
4. Recon captures every meaningful UI state: before and after actions, modal/form states, and opened dropdown states such as Role or Status.
5. `generate` sends scenario, plan, payload, and recon snapshots to the configured LLM provider and writes tests to `tests/generated/`.
6. `validate` performs static locator risk checks and writes `reports/locator-validation.json`.
7. `run:generated` runs `tests/generated` with Playwright and writes `reports/run-result.json`.
8. `heal` asks the configured LLM provider to repair only locator, wait, and assertion failures, then writes repaired tests to `tests/healed/`.
9. `report` writes `reports/result.json` and `reports/result.html`.

## Recon step quality and LLM quota

Recon executes **`scenarios/*.json` steps** (from Excel via `build:scenarios`), not the Markdown plan in `specs/`.

- Write **atomic** test steps in `input/test_flow.xlsx` (one action per numbered step). Compound lines such as “click search and search the user name” are auto-split when possible, but clear steps produce better recon.
- Recon uses Gemini/OpenAI when deterministic locator resolution is ambiguous. Free-tier Gemini quotas can block later steps; increase quota, switch model, or set `RECON_ALLOW_UNSAFE_FALLBACK=true` to allow validated non-safe locator fallback after LLM failure.
- After changing Excel or normalizer logic: `npm run build:scenarios && npm run recon`.

Regenerate a single spec from recon summary:

```bash
npm run regenerate:spec TC-UM-003
```

## Recon Behavior

Recon is state-based, not a single page scan. It follows the actual user journey:

- Open login page, scan it.
- Log in, scan dashboard.
- Navigate or click based on scenario steps.
- Capture state before and after each action.
- Open dropdowns mentioned in steps and capture available options.
- If an action cannot be performed, it still writes a snapshot with `action_error` and continues where possible.

Recon now also adds deterministic execution safety and telemetry:

- Waits for snapshot stability before scanning (DOM ready, RAF settle, mutation quiet window, bounded timeout).
- Writes snapshot telemetry (`stabilization`, `snapshotSessionId`, `snapshotSequence`) into recon JSON.
- Enriches elements and selected candidates with structural selector metadata (`selectorConfidenceScore`, `selectorRisk`, `selectorConfidenceSignals`).
- Logs parser status and failure categories (`parse_failure`, `locator_failure`, `postcondition_failure`).
- Runs lightweight postcondition checks after actions to prevent silent cascade failures.

The first version intentionally uses heuristic actions such as:

- `navigate to X` or `go to X`
- `click X`
- `add user`
- Role and Status dropdown opening
- Generic payload field filling when the step asks to fill or enter form data

## LLM Usage

The configured LLM provider (`LLM_PROVIDER`) is used in three places:

- Planner: scenario JSON to Markdown test plan.
- Generator: scenario, plan, and recon snapshots to Playwright TypeScript tests.
- Healer: failed run output plus recon snapshots to repaired tests.

The framework does not send login passwords to the LLM provider. Generated tests must use `process.env.LOGIN_PASSWORD`.

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
