import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";
import {
  ArtifactInput,
  ArtifactInputSchema,
  ArtifactScenarioListInputSchema,
} from "../schemas/artifactInput.schema";
import { TestCaseInput, TestStepInput } from "../schemas/testCase.schema";
import {
  generatePlaywrightFeature,
  GenerationResult,
} from "./playwrightFeatureGenerator";
import { safeIdentifier, toCamelCase } from "./names";

type ScenarioRow = Record<string, string>;

type DataRecord = {
  scenario_id: string;
  record_id?: string;
  data_strategy?: string;
  edge_case_type?: string | null;
  payload?: Record<string, unknown>;
};

export function listArtifactScenarios(rawInput: unknown): {
  total: number;
  returned: number;
  offset: number;
  scenarios: Array<Record<string, unknown>>;
} {
  const input = ArtifactScenarioListInputSchema.parse(rawInput);
  const scenarios = readScenarioCsv(input.scenariosCsvPath);
  const dataRecords = readTestDataJson(input.testDataJsonPath);
  const dataByScenario = new Map(
    dataRecords.map((record) => [record.scenario_id, record]),
  );

  const filtered = scenarios.filter((scenario) => {
    if (!input.automationSuitability || input.automationSuitability === "All") {
      return true;
    }
    return scenario["Automation Suitability"] === input.automationSuitability;
  });
  const offset = input.offset || 0;
  const limit = input.limit || 50;
  const page = filtered.slice(offset, offset + limit);

  return {
    total: filtered.length,
    returned: page.length,
    offset,
    scenarios: page.map((scenario) => {
      const scenarioId = scenario["Test Case ID"];
      const dataRecord = dataByScenario.get(scenarioId);
      return {
        scenarioId,
        title: scenario["Test Case Name"],
        module: scenario.Module,
        subModule: scenario["Sub Module"],
        priority: scenario.Priority,
        category: scenario["Test Category"],
        automationSuitability: scenario["Automation Suitability"],
        hasTestData: Boolean(dataRecord),
        dataStrategy: dataRecord?.data_strategy || "",
        edgeCaseType: dataRecord?.edge_case_type || "",
        dataKeys: Object.keys(dataRecord?.payload || {}),
        objective: scenario["Test Objective"],
        preconditions: scenario.Preconditions,
        stepsPreview: splitNumberedText(scenario["Test Steps"]).slice(0, 5),
        expectedPreview: splitNumberedText(scenario["Expected Results"]).slice(
          0,
          3,
        ),
      };
    }),
  };
}

export async function generatePlaywrightFromArtifacts(
  rawInput: unknown,
): Promise<GenerationResult> {
  const input = ArtifactInputSchema.parse(rawInput);
  const block = getArtifactScenarioBlock(input);
  if (block) {
    return {
      ok: false,
      dryRun: input.options.dryRun,
      feature: block.featureName,
      files: [],
      issues: [
        {
          severity: "error",
          file: "artifact-input",
          rule: block.reason,
          message: block.message,
        },
      ],
      warnings: [],
    };
  }
  const testCaseInput = buildTestCaseInputFromArtifacts(input);
  return generatePlaywrightFeature(testCaseInput);
}

export function getArtifactScenarioBlock(
  rawInput: unknown,
):
  | {
      scenarioId: string;
      title: string;
      featureName: string;
      reason: "visible_user_identifier_required";
      message: string;
    }
  | undefined {
  const input = ArtifactInputSchema.parse(rawInput);
  const scenarios = readScenarioCsv(input.scenariosCsvPath);
  const scenario = scenarios.find(
    (row) => row["Test Case ID"] === input.scenarioId,
  );
  if (!scenario) return undefined;

  const dataRecord = readTestDataJson(input.testDataJsonPath).find(
    (record) => record.scenario_id === input.scenarioId,
  );
  if (!dataRecord) return undefined;

  const normalizedPayload = normalizePayload(dataRecord.payload || {});
  Object.assign(normalizedPayload, input.testData || {});
  addDerivedNameFields(normalizedPayload);
  const needsVisibleUser = splitNumberedText(scenario["Test Steps"]).some(
    (instruction) => isSelectUserInstruction(instruction),
  );

  if (!needsVisibleUser || resolveVisibleUserIdentifier(normalizedPayload)) {
    return undefined;
  }

  return {
    scenarioId: input.scenarioId,
    title: scenario["Test Case Name"] || input.scenarioId,
    featureName:
      input.featureName ||
      [scenario.Module || "Generated Feature", input.scenarioId]
        .filter(Boolean)
        .join(" "),
    reason: "visible_user_identifier_required",
    message:
      "This scenario says to select an existing user, but the uploaded test data only has a hidden User ID. Add a browser-visible identifier such as Email Address, Full Name, or First Name + Last Name so the generated test can select the correct row without guessing.",
  };
}

export function buildTestCaseInputFromArtifacts(
  rawInput: unknown,
): TestCaseInput {
  const input = ArtifactInputSchema.parse(rawInput);
  const scenarios = readScenarioCsv(input.scenariosCsvPath);
  const scenario = scenarios.find(
    (row) => row["Test Case ID"] === input.scenarioId,
  );
  if (!scenario) {
    throw new Error(
      `Scenario '${input.scenarioId}' was not found in ${input.scenariosCsvPath}.`,
    );
  }

  const dataRecords = readTestDataJson(input.testDataJsonPath);
  const dataRecord = dataRecords.find(
    (record) => record.scenario_id === input.scenarioId,
  );
  if (!dataRecord) {
    throw new Error(
      `Test data for scenario '${input.scenarioId}' was not found in ${input.testDataJsonPath}.`,
    );
  }

  const normalizedPayload = normalizePayload(dataRecord.payload || {});
  Object.assign(normalizedPayload, input.testData || {});
  addDerivedNameFields(normalizedPayload);
  applyPortalDataNormalizations(scenario, normalizedPayload);
  if (input.baseUrl) {
    normalizedPayload.baseUrl = input.baseUrl;
  }
  const testData: Record<string, string | number | boolean> = {
    ...normalizedPayload,
    scenarioId: input.scenarioId,
    testCaseName: scenario["Test Case Name"] || input.scenarioId,
    expectedResult:
      scenario["Expected Results"] || scenario["Pass Criteria"] || "",
    passCriteria: scenario["Pass Criteria"] || "",
    dataStrategy: dataRecord.data_strategy || "",
    edgeCaseType: dataRecord.edge_case_type || "",
  };

  const steps = buildSteps(
    scenario,
    normalizedPayload,
    Boolean(input.baseUrl),
    shouldLoginBeforeScenario(input, scenario),
  );

  return {
    featureName:
      input.featureName ||
      [scenario.Module || "Generated Feature", input.scenarioId]
        .filter(Boolean)
        .join(" "),
    testId: input.scenarioId,
    title: scenario["Test Case Name"] || input.scenarioId,
    description: scenario["Test Objective"] || scenario["Test Basis"] || "",
    expectedResult:
      scenario["Expected Results"] || scenario["Pass Criteria"] || "",
    testData,
    steps,
    options: {
      dryRun: input.options.dryRun,
      overwrite: input.options.overwrite,
      updateFixtures: input.options.updateFixtures,
    },
  };
}

function readScenarioCsv(csvPath: string): ScenarioRow[] {
  assertFileExists(csvPath);
  const workbook = XLSX.readFile(csvPath, { type: "file" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<ScenarioRow>(sheet, { defval: "" });
}

function readTestDataJson(jsonPath: string): DataRecord[] {
  assertFileExists(jsonPath);
  const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(
      `Expected ${jsonPath} to contain an array of test data records.`,
    );
  }
  return parsed as DataRecord[];
}

function assertFileExists(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Input file does not exist: ${filePath}`);
  }
}

function normalizePayload(
  payload: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const normalized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(payload)) {
    const normalizedKey = safeIdentifier(key, "value");
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      normalized[normalizedKey] = value;
    } else if (value !== null && value !== undefined) {
      normalized[normalizedKey] = String(value);
    }
  }
  addDerivedNameFields(normalized);
  return normalized;
}

function addDerivedNameFields(
  payload: Record<string, string | number | boolean>,
): void {
  const firstName = payload.firstName;
  const lastName = payload.lastName;
  const fullName = payload.fullName;

  if (!fullName && firstName && lastName) {
    payload.fullName = `${firstName} ${lastName}`;
    return;
  }

  if (
    fullName &&
    typeof fullName === "string" &&
    (!firstName || !lastName)
  ) {
    const [first, ...rest] = fullName.trim().split(/\s+/);
    if (first && !firstName) payload.firstName = first;
    if (rest.length && !lastName) payload.lastName = rest.join(" ");
  }
}

function applyPortalDataNormalizations(
  scenario: ScenarioRow,
  payload: Record<string, string | number | boolean>,
): void {
  if (!isUserCreationScenario(scenario)) return;

  if (String(payload.role || "").toLowerCase() === "executive") {
    payload.role = "Workflow Operators";
  }

  if (String(payload.status || "").toLowerCase() === "pending") {
    payload.status = "Password Not Set";
  }

  if (
    typeof payload.emailAddress === "string" &&
    !isExistingEmailConstraintScenario(scenario)
  ) {
    payload.emailAddress = uniqueEmailAddress(payload.emailAddress);
  }
}

function isUserCreationScenario(scenario: ScenarioRow): boolean {
  const text = scenarioText(scenario);
  return /\b(add\s+user|internal\s+user|create\s+user|user\s+creation)\b/i.test(
    text,
  );
}

function isExistingEmailConstraintScenario(scenario: ScenarioRow): boolean {
  return /\b(existing\s+email|unique\s+user\s+email|duplicate|already\s+exists)\b/i.test(
    scenarioText(scenario),
  );
}

function scenarioText(scenario: ScenarioRow): string {
  return [
    scenario["Test Case ID"],
    scenario["Test Case Name"],
    scenario["Test Objective"],
    scenario["Test Steps"],
    scenario["Expected Results"],
    scenario["Pass Criteria"],
  ]
    .filter(Boolean)
    .join(" ");
}

function uniqueEmailAddress(emailAddress: string): string {
  const [localPart, domain] = emailAddress.split("@");
  if (!localPart || !domain) return emailAddress;
  const suffix = `auto${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return `${localPart}+${suffix}@${domain}`;
}

function buildSteps(
  scenario: ScenarioRow,
  payload: Record<string, string | number | boolean>,
  shouldOpenBaseUrl: boolean,
  shouldLogin: boolean,
): TestStepInput[] {
  const steps: TestStepInput[] = [];
  if (shouldLogin) {
    steps.push({ action: "login" });
  }

  if (shouldOpenBaseUrl && !shouldLogin) {
    steps.push({ action: "goto", valueKey: "baseUrl" });
  }

  for (const instruction of splitNumberedText(scenario["Test Steps"]).flatMap(
    expandCompoundInstruction,
  )) {
    const mapped = mapInstructionToStep(instruction, payload);
    steps.push(...mapped);
  }

  const assertion = buildAssertionStep(scenario, payload);
  if (assertion) {
    steps.push(assertion);
  }

  if (!steps.some((step) => step.action.startsWith("expect"))) {
    steps.push({
      action: "expectText",
      target: "expected result",
      locator: {
        kind: "text",
        value: String(
          payload.expectedResult || scenario["Pass Criteria"] || "",
        ),
        exact: false,
      },
      expectedTextKey: "expectedResult",
    });
  }

  return steps;
}

function shouldLoginBeforeScenario(
  input: ArtifactInput,
  _scenario: ScenarioRow,
): boolean {
  // Generated portal UI tests must be independent because Playwright can run
  // each spec in a fresh browser context. Default every artifact scenario to login.
  if (typeof input.loginBefore === "boolean") return input.loginBefore;
  return true;
}

function mapInstructionToStep(
  instruction: string,
  payload: Record<string, string | number | boolean>,
): TestStepInput[] {
  const text = normalizeText(instruction);
  const lower = text.toLowerCase();

  if (lower.startsWith("navigate to ")) {
    const destination = text.replace(/^navigate to\s+/i, "");
    return destination
      .split(/\s*(?:→|>|\/)\s*/)
      .map((part) => part.trim())
      .filter((part) => !isGenericNavigationContainer(part))
      .filter(Boolean)
      .map((part) => ({
        action: "click",
        target: `${part} navigation`,
        locator: { kind: "text", value: part, exact: false },
      }));
  }

  const clickMatch = /^click(?:\s+on)?\s+(.+)$/i.exec(text);
  if (clickMatch) {
    const label = normalizeKnownControlLabel(cleanControlLabel(clickMatch[1]));
    const isInternalUserOption = label === "Add Internal User";
    return [
      {
        action: "click",
        target: isInternalUserOption ? label : `${label} button`,
        locator: isInternalUserOption
          ? { kind: "text", value: label, exact: true }
          : { kind: "role", role: "button", name: label },
      },
    ];
  }

  const enterMatch = /^(?:enter|fill(?: in)?)\s+(.+)$/i.exec(text);
  if (enterMatch) {
    const label = normalizeKnownFieldLabel(cleanControlLabel(enterMatch[1]));
    if (isCombinedNameLabel(label)) {
      return buildNameFieldSteps();
    }

    return [
      {
        action: "fill",
        target: `${label} input`,
        locator: { kind: "label", value: label },
        valueKey: resolveValueKey(label, payload),
      },
    ];
  }

  if (isSelectUserInstruction(text)) {
    const userText = resolveVisibleUserIdentifier(payload) || "visible user";
    return [
      {
        action: "click",
        target: "selected user row",
        locator: { kind: "text", value: userText, exact: false },
      },
    ];
  }

  const selectMatch = /^select\s+(.+?)(?:\s+from.*)?$/i.exec(text);
  if (selectMatch) {
    const label = normalizeKnownFieldLabel(cleanControlLabel(selectMatch[1]));
    return [
      {
        action: "select",
        target: `${label} dropdown`,
        locator: dropdownLocatorForLabel(label),
        valueKey: resolveValueKey(label, payload),
      },
    ];
  }

  const openMatch = /^open\s+(.+)$/i.exec(text);
  if (openMatch) {
    const label = cleanControlLabel(openMatch[1]);
    return [
      {
        action: "click",
        target: `${label} link`,
        locator: { kind: "text", value: label, exact: false },
      },
    ];
  }

  return [];
}

function expandCompoundInstruction(instruction: string): string[] {
  const text = normalizeText(instruction);
  if (!/^click(?:\s+on)?\s+/i.test(text) || !/\band\s+click\b/i.test(text)) {
    return [text];
  }

  const first = text.replace(/^click(?:\s+on)?\s+/i, "");
  return first
    .split(/\s+and\s+click(?:\s+on)?\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `Click on ${part}`);
}

function isGenericNavigationContainer(label: string): boolean {
  return /^(settings|menu|navigation|sidebar)$/i.test(label.trim());
}

function normalizeKnownControlLabel(label: string): string {
  if (/^(?:new\s+)?internal\s+user$/i.test(label.trim())) {
    return "Add Internal User";
  }
  return label;
}

function normalizeKnownFieldLabel(label: string): string {
  const trimmed = label.trim();
  if (/\bemail\s+address\b/i.test(trimmed)) {
    return "Email Address";
  }
  if (/\bfirst\s+name\b/i.test(trimmed) && !/\blast\s+name\b/i.test(trimmed)) {
    return "First Name";
  }
  if (/\blast\s+name\b/i.test(trimmed) && !/\bfirst\s+name\b/i.test(trimmed)) {
    return "Last Name";
  }
  if (/\brole\b/i.test(trimmed)) {
    return "Role";
  }
  return trimmed;
}

function dropdownLocatorForLabel(label: string): TestStepInput["locator"] {
  // PrimeReact dropdowns/multiselects are usually div/button based controls,
  // not native <select> elements. Prefer an accessible combobox lookup so the
  // generated page object can click the control and then select a scoped option
  // from the visible overlay panel.
  return { kind: "role", role: "combobox", name: label, exact: false };
}

function isCombinedNameLabel(label: string): boolean {
  const normalized = label.toLowerCase();
  return (
    /\bfull\s+name\b/.test(normalized) ||
    (/\bfirst\s+name\b/.test(normalized) && /\blast\s+name\b/.test(normalized))
  );
}

function buildNameFieldSteps(): TestStepInput[] {
  return [
    {
      action: "fill",
      target: "First Name input",
      locator: { kind: "placeholder", value: "Enter first name" },
      valueKey: "firstName",
    },
    {
      action: "fill",
      target: "Last Name input",
      locator: { kind: "placeholder", value: "Enter last name" },
      valueKey: "lastName",
    },
  ];
}

function isSelectUserInstruction(text: string): boolean {
  return /^select\s+(?:the\s+)?user\b/i.test(text);
}

function resolveVisibleUserIdentifier(
  payload: Record<string, string | number | boolean>,
): string | undefined {
  const email = payload.emailAddress || payload.email;
  if (email) return String(email);

  if (payload.fullName) return String(payload.fullName);

  if (payload.firstName && payload.lastName) {
    return `${payload.firstName} ${payload.lastName}`;
  }

  return undefined;
}

function buildAssertionStep(
  scenario: ScenarioRow,
  payload: Record<string, string | number | boolean>,
): TestStepInput | undefined {
  const expected = normalizeText(
    `${scenario["Expected Results"] || ""} ${scenario["Pass Criteria"] || ""}`,
  );
  const visibleKeys = ["fullName", "emailAddress", "email", "status", "role"];
  for (const key of visibleKeys) {
    const value = payload[key];
    if (value && expected.toLowerCase().includes(String(value).toLowerCase())) {
      return {
        action: "expectText",
        target: `${key} result`,
        locator: { kind: "text", value: String(value), exact: false },
        expectedTextKey: key,
      };
    }
  }

  if (payload.status) {
    return {
      action: "expectText",
      target: "status result",
      locator: { kind: "text", value: String(payload.status), exact: false },
      expectedTextKey: "status",
    };
  }

  if (payload.fullName) {
    return {
      action: "expectText",
      target: "created user result",
      locator: { kind: "text", value: String(payload.fullName), exact: false },
      expectedTextKey: "fullName",
    };
  }

  return undefined;
}

function splitNumberedText(value: string): string[] {
  return normalizeText(value)
    .replace(/\s*(?:\r?\n)+\s*/g, "; ")
    .split(/\s*;\s*/)
    .map((part) => part.replace(/^(?:\d+[.)]|[-*•])\s*/, "").trim())
    .filter(Boolean);
}

function normalizeText(value: string): string {
  return value
    .replaceAll("â", "→")
    .replaceAll("â†’", "→")
    .replace(/[^\S\r\n]+/g, " ")
    .trim();
}

function cleanControlLabel(value: string): string {
  return normalizeText(value)
    .replace(/\s+(field|dropdown|button|link|input)$/i, "")
    .replace(/^the\s+/i, "")
    .trim();
}

function resolveValueKey(
  label: string,
  payload: Record<string, string | number | boolean>,
): string {
  const alias = resolveValueAlias(label, payload);
  if (alias) return alias;

  const direct = toCamelCase(label);
  if (direct in payload) return direct;

  const labelWords = new Set(
    label
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  const fuzzy = Object.keys(payload).find((key) => {
    const keyWords = new Set(
      key
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean),
    );
    return [...labelWords].every((word) => keyWords.has(word));
  });
  return fuzzy || direct;
}

function resolveValueAlias(
  label: string,
  payload: Record<string, string | number | boolean>,
): string | undefined {
  const normalized = label.toLowerCase();
  const candidates: string[] = [];

  if (/\bemail\s+address\b/.test(normalized)) {
    candidates.push("emailAddress", "email");
  }
  if (/\bfirst\s+name\b/.test(normalized)) {
    candidates.push("firstName");
  }
  if (/\blast\s+name\b/.test(normalized)) {
    candidates.push("lastName");
  }
  if (/\bfull\s+name\b/.test(normalized)) {
    candidates.push("fullName");
  }
  if (/\brole\b/.test(normalized)) {
    candidates.push("role");
  }
  if (/\bstatus\b/.test(normalized)) {
    candidates.push("status");
  }
  if (/\buser\b/.test(normalized)) {
    candidates.push("emailAddress", "fullName", "firstName");
  }

  return candidates.find((key) => key in payload);
}
