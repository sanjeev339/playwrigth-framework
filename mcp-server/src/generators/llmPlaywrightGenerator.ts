import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
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
  generatePlaywrightFeature,
} from "./playwrightFeatureGenerator";
import {
  buildTestCaseInputFromArtifacts,
  getArtifactScenarioBlock,
} from "./artifactInputAdapter";
import { callLlmProvider, resolveLlmProvider } from "./llmProvider";
import {
  discoverLocatorEvidence,
} from "./locatorDiscovery";

type FileOperation = GeneratedFile & {
  status: "created" | "updated" | "skipped" | "preview";
};

type FileBackup = {
  path: string;
  existed: boolean;
  content?: string;
};

type TypeCheckResult = {
  ok: boolean;
  output: string;
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

type ResolvedSource = ReturnType<typeof resolveSource> & {
  domReconMarkdown?: string;
  domReconWarnings?: string[];
};

const repoRoot = process.cwd();
const MAX_LLM_ATTEMPTS = 5;
const PLAYWRIGHT_SKILL_PATH = "playwright_automation_framework_SKILL.md";
const MAX_SKILL_EXCERPT_CHARS = 2500;

export async function generatePlaywrightWithLlm(
  rawInput: unknown,
): Promise<LlmGenerationResult> {
  const input = LlmPlaywrightInputSchema.parse(rawInput);
  const artifactBlock = input.artifact
    ? getArtifactScenarioBlock({
        scenarioId: input.artifact.scenarioId,
        scenariosCsvPath: input.artifact.scenariosCsvPath,
        testDataJsonPath: input.artifact.testDataJsonPath,
        baseUrl: input.baseUrl,
        featureName: input.featureName,
        testData: input.testData,
        loginBefore: input.loginBefore ?? true,
        options: input.options,
      })
    : undefined;

  if (artifactBlock) {
    return {
      ok: false,
      dryRun: input.options.dryRun,
      feature: artifactBlock.featureName,
      provider: resolveLlmProvider(input.provider),
      model: input.model,
      files: [],
      issues: [
        {
          severity: "error",
          file: "artifact-input",
          rule: artifactBlock.reason,
          message: artifactBlock.message,
        },
      ],
      warnings: [],
    };
  }

  const source = await enrichSourceWithDomRecon(input, resolveSource(input));
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
    const fallback = await tryDeterministicFrameworkFallback(
      input,
      source,
      names,
      prepared.warnings,
      prepared.raw,
    );
    if (fallback) return fallback;

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

  const applyResult = applyFileOperations(
    prepared.plannedFiles,
    dryRun,
    input.options.overwrite,
    prepared.warnings,
  );

  if (applyResult.issues.length) {
    return {
      ok: false,
      dryRun,
      feature: names.featureName,
      provider,
      model: input.model,
      files: applyResult.files,
      issues: [...prepared.issues, ...applyResult.issues],
      warnings: prepared.warnings,
      llmRawPreview: prepared.raw.slice(0, 2000),
    };
  }

  return {
    ok: true,
    dryRun,
    feature: names.featureName,
    provider,
    model: input.model,
    files: applyResult.files,
    issues: prepared.issues,
    warnings: prepared.warnings,
  };
}

async function prepareLlmOutput(
  input: LlmPlaywrightInput,
  source: ResolvedSource,
  names: FeatureNames,
  provider: ReturnType<typeof resolveLlmProvider>,
  requiredFiles: string[],
): Promise<PreparedLlmOutput> {
  const warnings: string[] = [...(source.domReconWarnings || [])];
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

      const issues = [
        ...validateGeneratedFiles(plannedFiles),
        ...validateLlmFrameworkContract(plannedFiles, names),
      ];
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
      testData: input.testData,
      loginBefore: input.loginBefore ?? true,
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

async function enrichSourceWithDomRecon(
  input: LlmPlaywrightInput,
  source: ReturnType<typeof resolveSource>,
): Promise<ResolvedSource> {
  const domReconEnabled = input.domRecon?.enabled !== false;
  if (!input.artifact || !domReconEnabled) {
    return source;
  }

  const recon = await discoverLocatorEvidence({
    scenarioId: input.artifact.scenarioId,
    featureName: source.featureName,
    title: source.title,
    description: source.description,
    steps: source.steps,
    testData: source.testData,
    headed: input.domRecon?.headed ?? true,
    outputDir: input.domRecon?.outputDir,
  });

  if (!recon.ok) {
    return {
      ...source,
      domReconWarnings: [
        `DOM recon was attempted but failed: ${recon.reason || "unknown error"}`,
      ],
    };
  }

  return {
    ...source,
    domReconMarkdown: recon.markdown,
    domReconWarnings: [
      `Locator discovery captured ${recon.moduleKey || "module"} / ${recon.screenKey || "screen"} map: ${recon.markdownPath}`,
      ...(recon.screenshotPath ? [`Locator discovery screenshot: ${recon.screenshotPath}`] : []),
    ],
  };
}

async function tryDeterministicFrameworkFallback(
  input: LlmPlaywrightInput,
  source: ResolvedSource,
  names: FeatureNames,
  warnings: string[],
  raw: string,
): Promise<LlmGenerationResult | undefined> {
  if (!Array.isArray(source.steps) || !source.steps.length) return undefined;

  const fallbackWarnings = [
    ...warnings,
    "LLM output failed framework contract validation. Falling back to deterministic framework scaffolding from the same artifact scenario so Page Object, Action, test data, spec, and fixtures keep the required structure.",
  ];
  const generated = await generatePlaywrightFeature({
    featureName: names.featureName,
    testId: source.testId,
    title: source.title,
    description: source.description,
    expectedResult: source.expectedResult,
    testData: source.testData,
    steps: source.steps,
    options: {
      dryRun: true,
      overwrite: input.options.overwrite,
      updateFixtures: input.options.updateFixtures,
    },
  });
  const fallbackFiles = generated.files.map((file) => ({
    path: file.path,
    content: file.content,
  }));
  const fallbackIssues = [
    ...validateGeneratedFiles(fallbackFiles),
    ...validateLlmFrameworkContract(fallbackFiles, names),
  ];

  if (hasBlockingIssues(fallbackIssues)) {
    return {
      ok: false,
      dryRun: input.options.dryRun,
      feature: names.featureName,
      provider: resolveLlmProvider(input.provider),
      model: input.model,
      files: fallbackFiles.map((file) => ({ ...file, status: "preview" })),
      issues: fallbackIssues,
      warnings: fallbackWarnings,
      llmRawPreview: raw.slice(0, 2000),
    };
  }

  const applyResult = applyFileOperations(
    fallbackFiles,
    input.options.dryRun,
    input.options.overwrite,
    fallbackWarnings,
  );

  return {
    ok: applyResult.issues.length === 0,
    dryRun: input.options.dryRun,
    feature: names.featureName,
    provider: resolveLlmProvider(input.provider),
    model: input.model,
    files: applyResult.files,
    issues: applyResult.issues,
    warnings: fallbackWarnings,
    llmRawPreview: raw.slice(0, 2000),
  };
}

function buildPrompt(
  input: LlmPlaywrightInput,
  source: ResolvedSource,
  names: FeatureNames,
  requiredFiles = getRequiredFilePaths(names),
): string {
  const skillInstructions = readPlaywrightSkillInstructions();

  return [
    "You are generating production Playwright TypeScript code inside an existing Page Object framework.",
    "Highest priority: satisfy the output contract exactly. Missing any required file is a generation failure.",
    "Return ONLY valid JSON. Do not wrap it in markdown.",
    "The JSON shape must be:",
    '{"files":[{"path":"...","content":"..."}]}',
    "The files array must contain exactly four entries.",
    "",
    "Required files, exactly these paths:",
    requiredFiles.map((file) => `- ${file}`).join("\n"),
    "",
    "Project skill rules from playwright_automation_framework_SKILL.md:",
    skillInstructions,
    "",
    "Framework rules:",
    "- Page object classes extend BasePage from '../../core/base/BasePage'.",
    "- Import BasePage exactly as: import { BasePage } from '../../core/base/BasePage';",
    "- Page object files import Page, Locator, expect from '@playwright/test'.",
    "- Page object constructors must be constructor(page: Page) { super(page); ... }. Never use constructor() or super() without page.",
    "- Action classes accept Page in the constructor and instantiate the page object.",
    "- Action imports for generated page objects must use ../../page_objects/<feature-dir>/<PageClass> from actions/<feature-dir>.",
    "- Artifact-generated portal tests must login at the start of every scenario because Playwright tests can run independently or in parallel.",
    "- Import LoginAction exactly as: import { LoginAction } from '../../actions/auth/LoginAction'; instantiate it in the action constructor with new LoginAction(page), then call this.loginAction.loginAndWaitForLoad() as the first awaited step in the action method.",
    "- Specs import test exactly as: import { test } from '../../fixtures/test.fixture';",
    "- Specs must use generated fixtures, actions, and page objects; do not destructure page, do not instantiate actions or page objects manually, and do not call page.goto/page.click/page.fill in specs.",
    "- Specs must not import generated Action or Page classes. The fixtures already provide them.",
    "- Test data files export the exact const/type names listed below.",
    "- Use stable locators: getByRole, getByLabel, getByPlaceholder, getByTestId, getByText.",
    "- Follow the team tiered locator standard safely: declare Locator[] candidate arrays with JSDoc comments for Tier 1 semantic, Tier 2 attribute/CSS, and Tier 3 XPath fallback, then resolve with this.firstVisibleLocator('purpose', candidates).",
    "- firstVisibleLocator and clickVisibleDropdownOption are inherited from BasePage. Never redefine, override, or copy those helper methods in generated Page Objects.",
    "- firstVisibleLocator is async. Only call it inside async methods as: const locator = await this.firstVisibleLocator('purpose', candidates). Never assign its Promise to a Locator field or constructor property.",
    "- Never use locator.or(...) for clickable elements. It causes strict mode violations when duplicate text exists.",
    "- XPath is allowed only as the final Tier 3 fallback inside a locator candidate array. Never make XPath the primary locator.",
    "- Do not use unscoped getByText(...) for dropdown options, role values, table row actions, or repeated labels.",
    "- For PrimeReact dropdown/multiselect controls: click the combobox/control first, then scope option selection inside the visible overlay panel such as .p-multiselect-panel, .p-dropdown-panel, .p-select-panel, or [role=\"listbox\"].",
    "- For table/list actions: first resolve the specific row using browser-visible data like email/fullName, then click the button/link inside that row. Do not click a global duplicate text match.",
    "- Do not use waitForTimeout.",
    "- Do not read process.env in generated files.",
    "- Every page-object assertion method must be named expectSomething, for example expectAssignedRoleVisible(). Do not name assertion methods verifySomething.",
    "- Every spec must include at least one assertion by calling a page object method whose name starts with expect.",
    "- Prefer web-first assertions like await expect(locator).toBeVisible().",
    "- Put the final assertion in the spec by calling a page object assertion method after the action method.",
    "- Include all action methods needed by the Action class inside the Page Object. Do not access private locators from Action classes.",
    "- User Management TC-UM-001 real DOM facts: click Add Internal User as visible text/card, first name placeholder is 'Enter first name', last name placeholder is 'Enter last name', email placeholder is 'Enter email address', role opens from visible text 'Select role', Save is a button whose name starts with Save.",
    "- User Management user selection is a list/table/search-row workflow, not a <select> labelled 'user'. Never generate getByLabel('user') or selectOption for selecting a user.",
    "- For user selection, prefer browser-visible email address, full name, or first name + last name. Do not use hidden UUID/userId as row text unless DOM evidence proves it is visible.",
    "- Use only data keys present in Scenario input.testData. Do not invent keys like firstNameAndLastName, existingEmailAddress, or selectedUser when equivalent keys already exist.",
    "",
    "Exact required skeleton pattern:",
    buildRequiredSkeleton(names),
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
        requiredOutputFileCount: requiredFiles.length,
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
        loginBefore: input.loginBefore ?? true,
        steps: source.steps,
        testData: source.testData,
      },
      null,
      2,
    ),
    "",
    "Live DOM recon evidence captured before generation:",
    source.domReconMarkdown ||
      "No DOM recon was captured for this scenario. If locator evidence is missing, use the deterministic artifact mapping and validation rules.",
    "",
    "DOM recon usage rules:",
    "- Treat this locator map as the source of truth over scenario wording.",
    "- Choose locators only from the captured accessibility tree, interactive locator map, tables, role options, and DOM evidence.",
    "- If a needed locator is absent from the locator map, fail generation by returning code that uses an explicit page-object assertion/action error rather than inventing a locator.",
    "- Use visible placeholders/text/roles from DOM recon before guessing labels.",
    "- If test data contains a value not present in DOM options, normalize to a visible option only when project artifact mapping already did so.",
    "- Keep Tier 1/Tier 2/Tier 3 locator candidate arrays and firstVisibleLocator.",
    "",
    "Final output checklist before responding:",
    `- files.length === ${requiredFiles.length}`,
    ...requiredFiles.map((file) => `- contains path ${file}`),
    "- every content value is a complete TypeScript file",
    "- response is raw JSON only",
  ].join("\n");
}

function buildRequiredSkeleton(names: FeatureNames): string {
  return [
    "Spec file must follow this shape:",
    `import { test } from '../../fixtures/test.fixture';`,
    `import { ${names.testDataConst} } from '../../test-data/${names.featureDir}/${names.featureDir}.data';`,
    "",
    `test.describe(${quote(names.featureName)}, () => {`,
    `  test('...', async ({ ${names.actionFixture}, ${names.pageFixture} }) => {`,
    `    await ${names.actionFixture}.${names.actionMethod}(${names.testDataConst});`,
    `    await ${names.pageFixture}.expectSomethingVisibleOrCorrect(...);`,
    "  });",
    "});",
    "",
    "Action file must expose this method:",
    `async ${names.actionMethod}(data: ${names.testDataType}): Promise<void> { ... }`,
    "",
    "Test data file must export exactly:",
    `export const ${names.testDataConst} = ... as const;`,
    `export type ${names.testDataType} = typeof ${names.testDataConst};`,
  ].join("\n");
}

function readPlaywrightSkillInstructions(): string {
  const skillPath = path.join(repoRoot, PLAYWRIGHT_SKILL_PATH);
  if (!fs.existsSync(skillPath)) {
    return [
      "Skill file was not found on disk.",
      "Fallback: keep strict layered Playwright generation with Page Object, Action, test data, spec, fixtures, stable locators, and no direct page usage in specs.",
    ].join("\n");
  }

  const content = fs.readFileSync(skillPath, "utf-8").trim();
  const frontmatterMatch = /^---[\s\S]*?---/.exec(content);
  const frontmatter = frontmatterMatch?.[0] || "";
  const excerpt = content.slice(
    frontmatter.length,
    frontmatter.length + MAX_SKILL_EXCERPT_CHARS,
  );

  return [
    "Source file exists and must be obeyed: playwright_automation_framework_SKILL.md.",
    "Condensed active rules:",
    "- Keep strict layered framework separation: spec -> action -> page object -> browser.",
    "- Reuse core/base, core/config, core/logger, auth login helpers, and fixtures.",
    "- Page Objects own locators, Playwright interactions, and web-first assertions.",
    "- Actions own business workflow and call Page Object methods only.",
    "- Specs use fixtures and test data only; no direct page usage or class construction.",
    "- Test data lives in test-data files; do not hardcode scenario payload in specs.",
    "- Prefer stable locators from live DOM evidence: role, label, placeholder, test id, text.",
    "- Use firstVisibleLocator with Tier 1 semantic, Tier 2 attribute/CSS, Tier 3 XPath fallback candidates when fallback locators are needed.",
    "- Do not use primary XPath, waitForTimeout, process.env, or brittle CSS unless unavoidable.",
    "- Verify every project import path is valid for the file location.",
    "- Generate complete files, not partial snippets.",
    "",
    "Short skill excerpt for context:",
    excerpt.trim(),
  ].join("\n");
}

function buildRepairPrompt(
  originalPrompt: string,
  requiredFiles: string[],
  failure: string,
  previousRaw: string,
): string {
  return [
    "You are repairing a Playwright TypeScript generation response.",
    "Return ONLY valid JSON. Do not wrap it in markdown.",
    "The JSON shape must be exactly:",
    '{"files":[{"path":"...","content":"..."}]}',
    "",
    "Your previous response failed validation.",
    `Failure: ${failure}`,
    "",
    "Return a complete replacement JSON object with exactly these four files and no extra files:",
    requiredFiles.map((file) => `- ${file}`).join("\n"),
    "",
    "Mandatory repair rules:",
    "Do not omit the page object, action, test data, or spec file.",
    "Do not change any required path.",
    "Page object constructor must be constructor(page: Page) and call super(page).",
    "Action class constructor must accept Page.",
    "Spec must import test from '../../fixtures/test.fixture', use generated fixtures, and include a final page-object assertion.",
    "Spec must not destructure page. It must destructure the generated fixtures only.",
    "Spec must not import the generated Action or Page classes.",
    "Action class must expose the exact action method requested in the original prompt.",
    "Test data file must export the exact const/type names requested in the original prompt.",
    "No primary XPath, no waitForTimeout, no direct page actions in spec, no generated class imports in spec.",
    "For User Management, do not use getByLabel('user') or selectOption to select a user. Use row/search/list locators based on available test data.",
    "Do not use locator.or(...) for click targets. Strict mode requires one resolved element. Use firstVisibleLocator with tiered Locator[] candidates instead.",
    "Do not redefine BasePage helpers such as firstVisibleLocator or clickVisibleDropdownOption.",
    "firstVisibleLocator returns Promise<Locator>; every call must be awaited inside an async Page Object method.",
    "XPath is allowed only as the final Tier 3 fallback inside a locator candidate array.",
    "For dropdown options such as role names, scope the option inside the open dropdown/listbox panel before clicking.",
    "Do not invent test data property names. Use only keys available in the original scenario testData.",
    "",
    "Original scenario and naming prompt excerpt:",
    originalPrompt.slice(0, 6500),
    "",
    "Previous response preview:",
    previousRaw.slice(0, 1000),
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

function validateLlmFrameworkContract(
  files: GeneratedFile[],
  names: FeatureNames,
): StabilityIssue[] {
  const issues: StabilityIssue[] = [];
  const byPath = new Map(files.map((file) => [file.path, file]));
  const pagePath = `page_objects/${names.featureDir}/${names.pageClass}.ts`;
  const actionPath = `actions/${names.featureDir}/${names.actionClass}.ts`;
  const dataPath = `test-data/${names.featureDir}/${names.featureDir}.data.ts`;
  const specPath = `tests/${names.featureDir}/${names.featureDir}.spec.ts`;
  const pageFile = byPath.get(pagePath);
  const actionFile = byPath.get(actionPath);
  const dataFile = byPath.get(dataPath);
  const specFile = byPath.get(specPath);

  for (const file of files) {
    if (/\.or\s*\(/.test(file.content)) {
      issues.push({
        severity: "error",
        file: file.path,
        rule: "no-locator-or",
        message: "Generated code must not use locator.or(...). Use one scoped locator instead to avoid strict mode violations.",
      });
    }

    if (/getByText\([^\n;]+\)\.click\s*\(/.test(file.content)) {
      issues.push({
        severity: "error",
        file: file.path,
        rule: "no-unscoped-text-click",
        message: "Generated code must not click unscoped getByText(...). Scope it to a row, dialog, menu, or dropdown panel first.",
      });
    }
  }

  if (pageFile) {
    expectContent(
      issues,
      pageFile,
      /import\s+\{\s*Page\s*,\s*Locator\s*,\s*expect\s*\}\s+from\s+['"`]@playwright\/test['"`]/,
      "page-object-imports-expect",
      "Page Object must import Page, Locator, and expect from @playwright/test.",
    );
    expectContent(
      issues,
      pageFile,
      /constructor\s*\(\s*page\s*:\s*Page\s*\)\s*\{[\s\S]*super\s*\(\s*page\s*\)/,
      "page-object-page-constructor",
      "Page Object constructor must accept page: Page and call super(page).",
    );
    expectContent(
      issues,
      pageFile,
      /\basync\s+expect[A-Z]\w*\s*\(/,
      "page-object-expect-method",
      "Page Object must expose at least one assertion method whose name starts with expect.",
    );
  }

  if (actionFile) {
    expectContent(
      issues,
      actionFile,
      new RegExp(`import\\s+\\{\\s*${names.pageClass}\\s*\\}\\s+from\\s+['"\`]\\.\\.\\/\\.\\.\\/page_objects\\/${names.featureDir}\\/${names.pageClass}['"\`]`),
      "action-page-import-path",
      "Action must import the generated Page Object using ../../page_objects/<feature-dir>/<PageClass>.",
    );
    expectContent(
      issues,
      actionFile,
      new RegExp(`async\\s+${names.actionMethod}\\s*\\(\\s*data\\s*:\\s*${names.testDataType}\\s*\\)\\s*:\\s*Promise\\s*<\\s*void\\s*>`),
      "action-method-contract",
      `Action must expose async ${names.actionMethod}(data: ${names.testDataType}): Promise<void>.`,
    );
  }

  if (dataFile) {
    expectContent(
      issues,
      dataFile,
      new RegExp(`export\\s+const\\s+${names.testDataConst}\\s*=`),
      "test-data-const-contract",
      `Test data must export const ${names.testDataConst}.`,
    );
    expectContent(
      issues,
      dataFile,
      new RegExp(`export\\s+type\\s+${names.testDataType}\\s*=\\s*typeof\\s+${names.testDataConst}`),
      "test-data-type-contract",
      `Test data must export type ${names.testDataType} = typeof ${names.testDataConst}.`,
    );
  }

  if (specFile) {
    expectContent(
      issues,
      specFile,
      /import\s+\{\s*test\s*\}\s+from\s+['"`]\.\.\/\.\.\/fixtures\/test\.fixture['"`]/,
      "spec-test-import-contract",
      "Spec must import { test } from '../../fixtures/test.fixture'.",
    );
    expectContent(
      issues,
      specFile,
      new RegExp(`import\\s+\\{\\s*${names.testDataConst}\\s*\\}\\s+from\\s+['"\`]\\.\\.\\/\\.\\.\\/test-data\\/${names.featureDir}\\/${names.featureDir}\\.data['"\`]`),
      "spec-test-data-import-contract",
      `Spec must import ${names.testDataConst} from the generated test data file.`,
    );
    expectContent(
      issues,
      specFile,
      new RegExp(`async\\s*\\(\\s*\\{\\s*${names.actionFixture}\\s*,\\s*${names.pageFixture}\\s*\\}`),
      "spec-fixture-contract",
      `Spec must use generated fixtures: { ${names.actionFixture}, ${names.pageFixture} }.`,
    );
    expectContent(
      issues,
      specFile,
      new RegExp(`${names.actionFixture}\\.${names.actionMethod}\\s*\\(\\s*${names.testDataConst}\\s*\\)`),
      "spec-action-contract",
      `Spec must call ${names.actionFixture}.${names.actionMethod}(${names.testDataConst}).`,
    );
    expectContent(
      issues,
      specFile,
      new RegExp(`${names.pageFixture}\\.expect[A-Z]\\w*\\s*\\(`),
      "spec-page-object-assertion-contract",
      `Spec must make the final assertion by calling a ${names.pageFixture}.expect... page-object method.`,
    );
  }

  return issues;
}

function expectContent(
  issues: StabilityIssue[],
  file: GeneratedFile,
  pattern: RegExp,
  rule: string,
  message: string,
): void {
  if (pattern.test(file.content)) return;
  issues.push({
    severity: "error",
    file: file.path,
    rule,
    message,
  });
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
): { files: FileOperation[]; issues: StabilityIssue[] } {
  const operations: FileOperation[] = [];

  if (dryRun) {
    return {
      files: files.map((file) => ({ ...file, status: "preview" })),
      issues: [],
    };
  }

  const baselineTypeCheck = runTypeCheck();
  if (!baselineTypeCheck.ok) {
    return {
      files: files.map((file) => ({ ...file, status: "preview" })),
      issues: [
        {
          severity: "error",
          file: "project",
          rule: "typescript-baseline",
          message: `Project TypeScript check is already failing before generation. Fix the baseline first.\n${truncateOutput(
            baselineTypeCheck.output,
          )}`,
        },
      ],
    };
  }

  const backups = backupFiles(files);

  for (const file of files) {
    const absolutePath = path.join(repoRoot, file.path);
    const exists = fs.existsSync(absolutePath);

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

  const generatedTypeCheck = runTypeCheck();
  if (!generatedTypeCheck.ok) {
    restoreBackups(backups);
    warnings.push(
      "Generated files were rolled back because TypeScript validation failed.",
    );
    return {
      files: operations.map((operation) => ({
        ...operation,
        status: "preview",
      })),
      issues: [
        {
          severity: "error",
          file: "project",
          rule: "typescript-generated",
          message: `Generated code failed TypeScript check and was rolled back.\n${truncateOutput(
            generatedTypeCheck.output,
          )}`,
        },
      ],
    };
  }

  return { files: operations, issues: [] };
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

function backupFiles(files: GeneratedFile[]): FileBackup[] {
  return files.map((file) => {
    const absolutePath = path.join(repoRoot, file.path);
    if (!fs.existsSync(absolutePath)) {
      return { path: file.path, existed: false };
    }
    return {
      path: file.path,
      existed: true,
      content: fs.readFileSync(absolutePath, "utf-8"),
    };
  });
}

function restoreBackups(backups: FileBackup[]): void {
  for (const backup of backups) {
    const absolutePath = path.join(repoRoot, backup.path);
    if (backup.existed) {
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, backup.content || "");
      continue;
    }
    if (fs.existsSync(absolutePath)) {
      fs.rmSync(absolutePath);
    }
  }
}

function runTypeCheck(): TypeCheckResult {
  try {
    execFileSync("corepack", ["pnpm", "exec", "tsc", "--noEmit"], {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 120_000,
    });
    return { ok: true, output: "" };
  } catch (error) {
    const typed = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    return {
      ok: false,
      output: [typed.stdout, typed.stderr, typed.message]
        .filter(Boolean)
        .map((part) => String(part))
        .join("\n"),
    };
  }
}

function truncateOutput(output: string): string {
  const normalized = output.trim();
  if (normalized.length <= 4000) return normalized;
  return `${normalized.slice(0, 4000)}\n... output truncated ...`;
}
