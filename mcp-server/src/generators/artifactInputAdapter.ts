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
  const testCaseInput = buildTestCaseInputFromArtifacts(input);
  return generatePlaywrightFeature(testCaseInput);
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
  return normalized;
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

  for (const instruction of splitNumberedText(scenario["Test Steps"])) {
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
  scenario: ScenarioRow,
): boolean {
  if (typeof input.loginBefore === "boolean") return input.loginBefore;

  const preconditions = normalizeText(
    `${scenario.Preconditions || ""} ${scenario["Pre-conditions"] || ""}`,
  );
  return /\blogged in\b/i.test(preconditions);
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
      .filter(Boolean)
      .map((part) => ({
        action: "click",
        target: `${part} navigation`,
        locator: { kind: "text", value: part, exact: false },
      }));
  }

  const clickMatch = /^click(?:\s+on)?\s+(.+)$/i.exec(text);
  if (clickMatch) {
    const label = cleanControlLabel(clickMatch[1]);
    return [
      {
        action: "click",
        target: `${label} button`,
        locator: { kind: "role", role: "button", name: label },
      },
    ];
  }

  const enterMatch = /^(?:enter|fill(?: in)?)\s+(.+)$/i.exec(text);
  if (enterMatch) {
    const label = cleanControlLabel(enterMatch[1]);
    return [
      {
        action: "fill",
        target: `${label} input`,
        locator: { kind: "label", value: label },
        valueKey: resolveValueKey(label, payload),
      },
    ];
  }

  const selectMatch = /^select\s+(.+?)(?:\s+from.*)?$/i.exec(text);
  if (selectMatch) {
    const label = cleanControlLabel(selectMatch[1]);
    return [
      {
        action: "select",
        target: `${label} dropdown`,
        locator: { kind: "label", value: label },
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
    .split(/\s*;\s*/)
    .map((part) => part.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
}

function normalizeText(value: string): string {
  return value
    .replaceAll("â", "→")
    .replaceAll("â†’", "→")
    .replace(/\s+/g, " ")
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
