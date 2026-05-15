import * as fs from "fs";
import * as path from "path";
import {
  LlmPlaywrightInput,
  LlmPlaywrightInputSchema,
} from "../schemas/llmPlaywright.schema";
import {
  GeneratedFile,
  StabilityIssue,
  hasBlockingIssues,
  validateGeneratedFiles,
} from "../validators/stabilityValidator";
import {
  FeatureNames,
  createFeatureNames,
  quote,
} from "./names";
import {
  buildActionFixtureFile,
  buildPageFixtureFile,
} from "./playwrightFeatureGenerator";
import { buildTestCaseInputFromArtifacts } from "./artifactInputAdapter";
import { callLlmProvider, resolveLlmProvider } from "./llmProvider";

type FileOperation = GeneratedFile & {
  status: "created" | "updated" | "skipped" | "preview";
};

export type LlmGenerationResult = {
  ok: boolean;
  dryRun: boolean;
  feature: string;
  provider: string;
  model?: string;
  files: FileOperation[];
  issues: StabilityIssue[];
  warnings: string[];
  llmRawPreview?: string;
};

type LlmGeneratedPayload = {
  files?: Array<{ path?: string; content?: string }>;
};

type PreparedLlmOutput = {
  raw: string;
  plannedFiles: GeneratedFile[];
  issues: StabilityIssue[];
  warnings: string[];
};

const repoRoot = process.cwd();
const MAX_LLM_ATTEMPTS = 3;

export async function generatePlaywrightWithLlm(
  rawInput: unknown,
): Promise<LlmGenerationResult> {
  const input = LlmPlaywrightInputSchema.parse(rawInput);
  const source = resolveSource(input);
  const names = createFeatureNames(source.featureName, source.title);
  const provider = resolveLlmProvider(input.provider);
  const requiredFiles = getRequiredFilePaths(names);
  const prepared = await prepareLlmOutput(
    input,
    source,
    names,
    provider,
    requiredFiles,
  );
  const dryRun = input.options.dryRun;

  if (hasBlockingIssues(prepared.issues)) {
    return {
      ok: false,
      dryRun,
      feature: names.featureName,
      provider,
      model: input.model,
      files: prepared.plannedFiles.map((file) => ({
        ...file,
        status: "preview",
      })),
      issues: prepared.issues,
      warnings: prepared.warnings,
      llmRawPreview: prepared.raw.slice(0, 2000),
    };
  }

  const files = applyFileOperations(
    prepared.plannedFiles,
    dryRun,
    input.options.overwrite,
    prepared.warnings,
  );

  return {
    ok: true,
    dryRun,
    feature: names.featureName,
    provider,
    model: input.model,
    files,
    issues: prepared.issues,
    warnings: prepared.warnings,
  };
}

async function prepareLlmOutput(
  input: LlmPlaywrightInput,
  source: ReturnType<typeof resolveSource>,
  names: FeatureNames,
  provider: ReturnType<typeof resolveLlmProvider>,
  requiredFiles: string[],
): Promise<PreparedLlmOutput> {
  const warnings: string[] = [];
  let prompt = buildPrompt(input, source, names, requiredFiles);
  let lastRaw = "";
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_LLM_ATTEMPTS; attempt += 1) {
    const raw = await callLlmProvider(provider, prompt, input.model);
    lastRaw = raw;

    try {
      const llmFiles = parseLlmFiles(raw);
      const plannedFiles = normalizeGeneratedFiles(llmFiles, requiredFiles);
      const attemptWarnings = collectWarnings(llmFiles, plannedFiles, raw);

      if (input.options.updateFixtures) {
        plannedFiles.push(buildPageFixtureFile(names));
        plannedFiles.push(buildActionFixtureFile(names));
      }

      const issues = validateGeneratedFiles(plannedFiles);
      if (!hasBlockingIssues(issues) || attempt === MAX_LLM_ATTEMPTS) {
        return {
          raw,
          plannedFiles,
          issues,
          warnings: [
            ...warnings,
            ...attemptWarnings,
            ...(!hasBlockingIssues(issues) && attempt > 1
              ? [`LLM generation succeeded after ${attempt} attempts.`]
              : hasBlockingIssues(issues)
                ? [
                    `LLM generation still failed stability validation after ${attempt} attempts.`,
                  ]
              : []),
          ],
        };
      }

      lastError = formatIssues(issues);
      warnings.push(
        `LLM attempt ${attempt} failed stability validation; retrying with repair instructions.`,
      );
      prompt = buildRepairPrompt(prompt, requiredFiles, lastError, raw);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === MAX_LLM_ATTEMPTS) {
        return {
          raw,
          plannedFiles: [],
          issues: [
            {
              severity: "error",
              file: "llm-response",
              rule: "invalid-llm-output",
              message: lastError,
            },
          ],
          warnings,
        };
      }

      warnings.push(
        `LLM attempt ${attempt} returned incomplete or invalid output; retrying with repair instructions.`,
      );
      prompt = buildRepairPrompt(prompt, requiredFiles, lastError, raw);
    }
  }

  return {
    raw: lastRaw,
    plannedFiles: [],
    issues: [
      {
        severity: "error",
        file: "llm-response",
        rule: "invalid-llm-output",
        message: lastError || "LLM did not produce usable Playwright files.",
      },
    ],
    warnings,
  };
}

function resolveSource(input: LlmPlaywrightInput): {
  featureName: string;
  title: string;
  testId?: string;
  description?: string;
  expectedResult?: string;
  baseUrl?: string;
  testData: Record<string, string | number | boolean>;
  steps?: unknown;
  prompt: string;
} {
  if (input.artifact) {
    const artifactCase = buildTestCaseInputFromArtifacts({
      scenarioId: input.artifact.scenarioId,
      scenariosCsvPath: input.artifact.scenariosCsvPath,
      testDataJsonPath: input.artifact.testDataJsonPath,
      baseUrl: input.baseUrl,
      featureName: input.featureName,
      loginBefore: input.loginBefore,
      options: {
        dryRun: true,
        overwrite: false,
        updateFixtures: false,
      },
    });
    return {
      featureName: input.featureName || artifactCase.featureName,
      title: input.title || artifactCase.title,
      testId: input.testId || artifactCase.testId,
      description: input.description || artifactCase.description,
      expectedResult: input.expectedResult || artifactCase.expectedResult,
      baseUrl: input.baseUrl,
      testData: { ...artifactCase.testData, ...input.testData },
      steps: artifactCase.steps,
      prompt:
        input.prompt ||
        `Generate Playwright code for artifact scenario ${input.artifact.scenarioId}.`,
    };
  }

  return {
    featureName: input.featureName || "Generated Feature",
    title: input.title || "generated Playwright test",
    testId: input.testId,
    description: input.description,
    expectedResult: input.expectedResult,
    baseUrl: input.baseUrl,
    testData: input.testData,
    prompt: input.prompt || "",
  };
}

function buildPrompt(
  input: LlmPlaywrightInput,
  source: ReturnType<typeof resolveSource>,
  names: FeatureNames,
  requiredFiles = getRequiredFilePaths(names),
): string {
  return [
    "You are generating production Playwright TypeScript code inside an existing Page Object framework.",
    "Return ONLY valid JSON. Do not wrap it in markdown.",
    "The JSON shape must be:",
    '{"files":[{"path":"...","content":"..."}]}',
    "The files array must contain exactly four entries.",
    "",
    "Required files, exactly these paths:",
    requiredFiles.map((file) => `- ${file}`).join("\n"),
    "",
    "Framework rules:",
    "- Page object classes extend BasePage from '../../core/base/BasePage'.",
    "- Import BasePage exactly as: import { BasePage } from '../../core/base/BasePage';",
    "- Page object files import Page, Locator, expect from '@playwright/test'.",
    "- Action classes accept Page in the constructor and instantiate the page object.",
    "- If login is needed, import LoginAction exactly as: import { LoginAction } from '../../actions/auth/LoginAction'; instantiate it in the action constructor with new LoginAction(page), then call this.loginAction.loginAndWaitForLoad().",
    "- Specs import test exactly as: import { test } from '../../fixtures/test.fixture';",
    "- Specs must use generated fixtures, actions, and page objects; do not destructure page, do not instantiate actions or page objects manually, and do not call page.goto/page.click/page.fill in specs.",
    "- Specs must not import generated Action or Page classes. The fixtures already provide them.",
    "- Test data files export the exact const/type names listed below.",
    "- Use stable locators: getByRole, getByLabel, getByPlaceholder, getByTestId, getByText.",
    "- Do not use XPath.",
    "- Do not use waitForTimeout.",
    "- Do not read process.env in generated files.",
    "- Every page-object assertion method must be named expectSomething, for example expectAssignedRoleVisible(). Do not name assertion methods verifySomething.",
    "- Every spec must include at least one assertion by calling a page object method whose name starts with expect.",
    "- Prefer web-first assertions like await expect(locator).toBeVisible().",
    "- Put the final assertion in the spec by calling a page object assertion method after the action method.",
    "",
    "Exact names to use:",
    JSON.stringify(
      {
        featureName: names.featureName,
        pageClass: names.pageClass,
        actionClass: names.actionClass,
        pageFixture: names.pageFixture,
        actionFixture: names.actionFixture,
        testDataConst: names.testDataConst,
        testDataType: names.testDataType,
        actionMethod: names.actionMethod,
      },
      null,
      2,
    ),
    "",
    "Scenario input:",
    JSON.stringify(
      {
        prompt: source.prompt,
        testId: source.testId,
        title: source.title,
        description: source.description,
        expectedResult: source.expectedResult,
        baseUrl: source.baseUrl,
        loginBefore: input.loginBefore,
        steps: source.steps,
        testData: source.testData,
      },
      null,
      2,
    ),
  ].join("\n");
}

function buildRepairPrompt(
  originalPrompt: string,
  requiredFiles: string[],
  failure: string,
  previousRaw: string,
): string {
  return [
    originalPrompt,
    "",
    "Your previous response failed validation.",
    `Failure: ${failure}`,
    "",
    "Repair instruction:",
    "Return a complete replacement JSON object with exactly these four files and no extra files:",
    requiredFiles.map((file) => `- ${file}`).join("\n"),
    "",
    "Do not omit the action, test data, or spec files.",
    "Do not change any required path.",
    "Return only JSON with the files array.",
    "",
    "Previous response preview:",
    previousRaw.slice(0, 1800),
  ].join("\n");
}

function parseLlmFiles(raw: string): GeneratedFile[] {
  const cleaned = cleanJson(raw);
  let payload: LlmGeneratedPayload;
  try {
    payload = JSON.parse(cleaned) as LlmGeneratedPayload;
  } catch (error) {
    throw new Error(
      `LLM did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!Array.isArray(payload.files) || !payload.files.length) {
    throw new Error("LLM JSON must contain a non-empty files array.");
  }

  return payload.files.map((file, index) => {
    if (!file.path || !file.content) {
      throw new Error(`LLM file entry ${index + 1} is missing path/content.`);
    }
    return {
      path: normalizeRelativePath(file.path),
      content: file.content,
    };
  });
}

function normalizeGeneratedFiles(
  files: GeneratedFile[],
  requiredFiles: string[],
): GeneratedFile[] {
  const allowed = new Set(requiredFiles);
  const byPath = new Map(files.map((file) => [file.path, file]));
  const missing = requiredFiles.filter((filePath) => !byPath.has(filePath));
  if (missing.length) {
    throw new Error(`LLM response missed required files: ${missing.join(", ")}`);
  }
  const unexpected = files.filter((file) => !allowed.has(file.path));
  if (unexpected.length) {
    throw new Error(
      `LLM response included unsupported files: ${unexpected
        .map((file) => file.path)
        .join(", ")}`,
    );
  }
  return requiredFiles.map((filePath) => byPath.get(filePath)!);
}

function getRequiredFilePaths(names: FeatureNames): string[] {
  return [
    `page_objects/${names.featureDir}/${names.pageClass}.ts`,
    `actions/${names.featureDir}/${names.actionClass}.ts`,
    `test-data/${names.featureDir}/${names.featureDir}.data.ts`,
    `tests/${names.featureDir}/${names.featureDir}.spec.ts`,
  ];
}

function formatIssues(issues: StabilityIssue[]): string {
  return issues
    .map((issue) => `${issue.file}: ${issue.rule} - ${issue.message}`)
    .join("; ");
}

function applyFileOperations(
  files: GeneratedFile[],
  dryRun: boolean,
  overwrite: boolean,
  warnings: string[],
): FileOperation[] {
  const operations: FileOperation[] = [];

  for (const file of files) {
    const absolutePath = path.join(repoRoot, file.path);
    const exists = fs.existsSync(absolutePath);

    if (dryRun) {
      operations.push({ ...file, status: "preview" });
      continue;
    }

    if (exists && !overwrite && !isFixtureFile(file.path)) {
      operations.push({ ...file, status: "skipped" });
      warnings.push(
        `Skipped existing file ${file.path}. Pass overwrite=true to replace it.`,
      );
      continue;
    }

    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, file.content);
    operations.push({ ...file, status: exists ? "updated" : "created" });
  }

  return operations;
}

function collectWarnings(
  llmFiles: GeneratedFile[],
  plannedFiles: GeneratedFile[],
  raw: string,
): string[] {
  const warnings: string[] = [];
  if (raw.trim().startsWith("```")) {
    warnings.push("LLM returned markdown fences; they were stripped.");
  }
  const fileCount = new Set(llmFiles.map((file) => file.path)).size;
  if (fileCount !== plannedFiles.length) {
    warnings.push("Duplicate file paths were collapsed during normalization.");
  }
  return warnings;
}

function cleanJson(raw: string): string {
  const stripped = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  if (stripped.startsWith("{")) return stripped;

  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start >= 0 && end > start) return stripped.slice(start, end + 1);
  return stripped;
}

function normalizeRelativePath(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (path.isAbsolute(normalized) || normalized.includes("../")) {
    throw new Error(`Unsafe generated file path: ${quote(filePath)}`);
  }
  return normalized;
}

function isFixtureFile(relativePath: string): boolean {
  return (
    relativePath === "fixtures/page.fixture.ts" ||
    relativePath === "fixtures/test.fixture.ts"
  );
}
