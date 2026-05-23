

# Dynamic Playwright Test Generation Skill

## Purpose

Use this skill whenever the user wants to generate Playwright automation dynamically from files placed inside the `input/` folder.

The automation must not be hardcoded for one fixed module, page, or test case. It must dynamically inspect the input files, understand the scenarios, inspect the live UI using Playwright MCP, generate Playwright scripts using the existing framework structure, run the tests, and report results.

## Repository Context

Before modifying files, always inspect and understand:

1. Existing folder structure
2. Existing spec file pattern
3. Existing page object pattern
4. Existing action layer pattern
5. Existing fixture pattern
6. Existing config/env loading mechanism
7. Existing test execution command
8. Existing naming conventions
9. Existing coding style

Use the existing framework style. Do not introduce a new architecture unless required.

## Input Folder

Always read raw input files from:

input/

The input folder may contain JSON, CSV, XLSX/Excel, Markdown, or text files.

For every file inside input/:

1. Detect file type
2. Parse file content
3. Identify test scenarios
4. Identify test steps
5. Identify test data
6. Identify expected results
7. Identify validation rules
8. Identify execution order if available
9. Identify dependencies if available
10. Identify module/page/feature names if available

If data is split across multiple files, combine them using scenario_id, test_case_id, title, module name, feature name, or semantic matching.

## Environment Configuration

Application URL and login credentials must come from the existing project .env or config system.

Never ask the user for application URL, username, or password unless they are missing from project configuration.

Never hardcode URL, username, or password in generated files.

Never print secret values in the final response.

If .env exists but is not loaded properly, add the minimum required dotenv/config support in the existing config layer.

## Dynamic Scenario Model

For every detected scenario, create a normalized scenario object with:

{
  "scenario_id": "",
  "scenario_title": "",
  "module_name": "",
  "feature_name": "",
  "execution_order": null,
  "depends_on": [],
  "preconditions": [],
  "test_steps": [],
  "payload": {},
  "expected_result": "",
  "validation_rules": [],
  "positive_or_negative_type": "",
  "edge_case_type": "",
  "source_file": "",
  "confidence_score": 0
}

Rules:

1. Do not invent unsupported steps.
2. If a field is missing, keep it null or infer carefully.
3. Add confidence score when inference is used.
4. Report ambiguity before implementation.
5. Respect execution_order if available.
6. Respect depends_on if available.
7. Report inconsistent dependencies or conflicting payloads.

## Normalized Output

Create normalized data only after understanding the input.

Preferred location:

test-data/normalized-scenarios.json

If the framework already has another test data location, follow the existing structure.

The spec file must read from normalized test data.

Do not hardcode scenario values inside spec files.

## Playwright MCP UI Inspection

Use Playwright MCP to inspect the live application.

Do not guess locators from input files alone.

For each scenario:

1. Open application using configured base URL.
2. Login using configured credentials if required.
3. Navigate according to scenario steps.
4. After every user action, rescan DOM/accessibility tree.
5. Discover available controls on the current page.
6. Match test step intent to UI controls.
7. Verify locator correctness before writing final code.
8. Capture locator mapping.

Locator priority:

1. data-testid
2. getByRole
3. getByLabel
4. getByPlaceholder
5. scoped getByText
6. stable CSS selector
7. XPath only as last option

Avoid random generated class names, dynamic IDs, brittle XPath, unscoped getByText, unnecessary nth(), and text locators that resolve to multiple elements.

For dropdowns, menus, modals, and popups:

1. Open the component first.
2. Inspect the visible popup/listbox/dialog.
3. Scope option locator inside the visible container.
4. Do not use global text matching for options.

## Script Generation Rules

Generate Playwright automation using the existing project style.

Do not create one hardcoded test per row.

Create reusable, data-driven automation.

Use existing fixtures, config manager, page objects, action layer, and helper utilities when available.

Generic reusable methods may include:

1. navigateToModule(moduleName)
2. performStep(step)
3. fillField(fieldName, value)
4. clickButton(buttonName)
5. selectDropdownValue(fieldName, value)
6. verifyTextVisible(expectedText)
7. verifyTableContains(payload)
8. verifyErrorMessage(expectedError)
9. searchRecord(searchValue)
10. editRecord(identifier, payload)

Only implement methods required by detected scenarios.

## File Creation Rules

Before modifying files, always show planned file changes.

Preferred dynamic structure:

input/
  raw uploaded files

test-data/
  normalized-scenarios.json

page_objects/
  dynamic/
    DynamicPage.ts

actions/
  dynamic/
    DynamicAction.ts

tests/
  dynamic/
    dynamic-generated.spec.ts

reports/
  dynamic-execution-result.json

If module name is reliable, create module-specific folders.

If module name is not reliable, use dynamic/.

Do not overwrite existing working files unless necessary.

If modifying fixtures or config, make the smallest safe change.

## Test Execution Rules

After implementation:

1. Install dependencies only if required.
2. If dependency installation fails because of peer dependency conflict, use:
   npm install --legacy-peer-deps
3. Run generated Playwright test.
4. Capture scenario-wise result.
5. If test fails due to locator issue, use Playwright MCP to reinspect and repair.
6. If test fails due to input data issue, report it.
7. If test fails due to application behavior, report it.
8. Do not hide failures.
9. Do not mark failed scenarios as passed.

## Final Report Format

After execution, return:

1. Input files detected
2. Parsed file types
3. Scenarios detected
4. Scenario normalization summary
5. Execution order
6. Dependencies detected
7. Ambiguities or missing fields
8. Data inconsistencies
9. Files created or modified
10. Locator mapping
11. Test command used
12. Scenario-wise pass/fail table
13. Failure reasons
14. Screenshots/traces/report path if generated
15. Recommended next fixes

Never print passwords or secret values.

## First Action Rule

Before implementation, first inspect repository structure, config/env loading, input folder, and existing Playwright framework style.

Then return only:

1. Framework understanding
2. Input files detected
3. Parsed scenario summary
4. Automation strategy
5. Planned files to create/update
6. Risks or ambiguities

Ask for permission before implementation.

## Implementation Trigger

Only after the user says Proceed, Implement, Create scripts, or Run tests, then create/update files, run tests, repair failures if possible, and return the final report.
EOF
