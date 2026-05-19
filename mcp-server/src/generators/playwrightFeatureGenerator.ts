import * as fs from "fs";
import * as path from "path";
import { McpConfig } from "../config/McpConfig";
import {
  LocatorInput,
  TestCaseInput,
  TestCaseInputSchema,
  TestStepInput,
} from "../schemas/testCase.schema";
import {
  FeatureNames,
  createFeatureNames,
  quote,
  safeIdentifier,
  toPascalCase,
} from "./names";
import {
  GeneratedFile,
  StabilityIssue,
  hasBlockingIssues,
  validateGeneratedFiles,
} from "../validators/stabilityValidator";

type FileOperation = GeneratedFile & {
  status: "created" | "updated" | "skipped" | "preview";
};

export type GenerationResult = {
  ok: boolean;
  dryRun: boolean;
  feature: string;
  files: FileOperation[];
  issues: StabilityIssue[];
  warnings: string[];
};

type TargetInfo = {
  name: string;
  propertyName: string;
  locator: LocatorInput;
};

const repoRoot = process.cwd();

export async function generatePlaywrightFeature(
  rawInput: unknown,
): Promise<GenerationResult> {
  const input = TestCaseInputSchema.parse(rawInput);
  const names = createFeatureNames(input.featureName, input.title);
  const dryRun = input.options.dryRun;
  const overwrite = input.options.overwrite;
  const updateFixtures = input.options.updateFixtures;
  const warnings = collectInputWarnings(input);
  const targets = collectTargets(input.steps);
  const plannedFiles = buildGeneratedFiles(input, names, targets);

  if (updateFixtures) {
    plannedFiles.push(buildPageFixtureFile(names));
    plannedFiles.push(buildActionFixtureFile(names));
  }

  const issues = validateGeneratedFiles(plannedFiles);
  const blocking = hasBlockingIssues(issues);

  if (blocking) {
    return {
      ok: false,
      dryRun,
      feature: names.featureName,
      files: plannedFiles.map((file) => ({ ...file, status: "preview" })),
      issues,
      warnings,
    };
  }

  const files: FileOperation[] = [];
  for (const file of plannedFiles) {
    const absolutePath = path.join(repoRoot, file.path);
    const exists = fs.existsSync(absolutePath);

    if (dryRun) {
      files.push({ ...file, status: "preview" });
      continue;
    }

    if (exists && !overwrite && !isFixtureFile(file.path)) {
      files.push({ ...file, status: "skipped" });
      warnings.push(
        `Skipped existing file ${file.path}. Pass overwrite=true to replace it.`,
      );
      continue;
    }

    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, file.content);
    files.push({ ...file, status: exists ? "updated" : "created" });
  }

  return {
    ok: true,
    dryRun,
    feature: names.featureName,
    files,
    issues,
    warnings,
  };
}

function buildGeneratedFiles(
  input: TestCaseInput,
  names: FeatureNames,
  targets: TargetInfo[],
): GeneratedFile[] {
  const featureDir = names.featureDir;

  return [
    {
      path: `page_objects/${featureDir}/${names.pageClass}.ts`,
      content: buildPageObject(input, names, targets),
    },
    {
      path: `actions/${featureDir}/${names.actionClass}.ts`,
      content: buildAction(input, names),
    },
    {
      path: `test-data/${featureDir}/${featureDir}.data.ts`,
      content: buildTestData(input, names),
    },
    {
      path: `tests/${featureDir}/${featureDir}.spec.ts`,
      content: buildSpec(input, names),
    },
  ];
}

function buildPageObject(
  input: TestCaseInput,
  names: FeatureNames,
  targets: TargetInfo[],
): string {
  const locatorFields = targets
    .map(
      (target) => `  /**
   * ${target.name}
   * Tier 1: semantic locator from DOM recon.
   * Tier 2: scoped text/attribute fallback.
   * Tier 3: XPath fallback only inside this candidate array.
   */
  readonly ${candidatePropertyName(target)}: Locator[];`,
    )
    .join("\n");

  const locatorAssignments = targets
    .map(
      (target) =>
        `    this.${candidatePropertyName(target)} = [\n${locatorCandidateExpressions(target)
          .map((candidate) => `      ${candidate},`)
          .join("\n")}\n    ];`,
    )
    .join("\n\n");

  const methods = targets
    .flatMap((target) => buildPageMethodsForTarget(input.steps, target))
    .join("\n\n");

  return `import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../../core/base/BasePage';

export class ${names.pageClass} extends BasePage {
${locatorFields || "  // No element locators were supplied for this scenario."}

  constructor(page: Page) {
    super(page);
${locatorAssignments || ""}
  }

  async goto(url: string): Promise<void> {
    await this.navigateTo(url);
  }

  async expectPageUrl(url: string | RegExp): Promise<void> {
    await expect(this.page).toHaveURL(url);
  }

${methods || "  async waitForReady(): Promise<void> {\n    await this.page.waitForLoadState('domcontentloaded');\n  }"}
}
`;
}

function buildPageMethodsForTarget(
  steps: TestStepInput[],
  target: TargetInfo,
): string[] {
  const methods: string[] = [];
  const matchingSteps = steps.filter((step) => step.target === target.name);
  const baseName = toPascalCase(target.name);

  if (matchingSteps.some((step) => step.action === "fill")) {
    methods.push(`  async fill${baseName}(value: string): Promise<void> {
    const locator = await this.firstVisibleLocator(${quote(target.name)}, this.${candidatePropertyName(target)});
    await locator.fill(value);
  }`);
  }

  if (matchingSteps.some((step) => step.action === "click")) {
    methods.push(`  async click${baseName}(): Promise<void> {
    const locator = await this.firstVisibleLocator(${quote(target.name)}, this.${candidatePropertyName(target)});
    await locator.click();
  }`);
  }

  if (matchingSteps.some((step) => step.action === "check")) {
    methods.push(`  async check${baseName}(): Promise<void> {
    const locator = await this.firstVisibleLocator(${quote(target.name)}, this.${candidatePropertyName(target)});
    await locator.check();
  }`);
  }

  if (matchingSteps.some((step) => step.action === "select")) {
    methods.push(`  async select${baseName}(value: string): Promise<void> {
    const locator = await this.firstVisibleLocator(${quote(target.name)}, this.${candidatePropertyName(target)});
    const tagName = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "");
    if (tagName === "select") {
      await locator.selectOption(value);
      return;
    }
    await locator.click();
    await this.clickVisibleDropdownOption(value);
  }`);
  }

  if (matchingSteps.some((step) => step.action === "expectVisible")) {
    methods.push(`  async expect${baseName}Visible(): Promise<void> {
    const locator = await this.firstVisibleLocator(${quote(target.name)}, this.${candidatePropertyName(target)});
    await expect(locator).toBeVisible();
  }`);
  }

  if (matchingSteps.some((step) => step.action === "expectText")) {
    methods.push(`  async expect${baseName}Text(expectedText: string | RegExp): Promise<void> {
    const locator = await this.firstVisibleLocator(${quote(target.name)}, this.${candidatePropertyName(target)});
    await expect(locator).toContainText(expectedText);
  }`);
  }

  return methods;
}

function buildAction(input: TestCaseInput, names: FeatureNames): string {
  const actionSteps = input.steps.filter((step) =>
    ["login", "goto", "fill", "click", "check", "select"].includes(
      step.action,
    ),
  );
  const body = actionSteps
    .map((step) => actionStepLine(step, names))
    .join("\n");
  const usesLogin = actionSteps.some((step) => step.action === "login");

  return `import { Page } from '@playwright/test';
import { ${names.pageClass} } from '../../page_objects/${names.featureDir}/${names.pageClass}';
import { ${names.testDataType} } from '../../test-data/${names.featureDir}/${names.featureDir}.data';
${usesLogin ? "import { LoginAction } from '../../actions/auth/LoginAction';\n" : ""}import { Logger } from '../../core/logger/Logger';

export class ${names.actionClass} {
  private readonly ${names.pageFixture}: ${names.pageClass};
${usesLogin ? "  private readonly loginAction: LoginAction;\n" : ""}

  constructor(page: Page) {
    this.${names.pageFixture} = new ${names.pageClass}(page);
${usesLogin ? "    this.loginAction = new LoginAction(page);\n" : ""}
  }

  async ${names.actionMethod}(data: ${names.testDataType}): Promise<void> {
    Logger.info(${quote(`Running generated scenario: ${input.title}`)});
${body || "    Logger.warn('No browser action steps were supplied for this scenario.');"}
  }
}
`;
}

function buildSpec(input: TestCaseInput, names: FeatureNames): string {
  const title = input.testId ? `${input.testId} - ${input.title}` : input.title;
  const assertionSteps = input.steps.filter((step) =>
    ["expectVisible", "expectText", "expectUrl"].includes(step.action),
  );
  const assertions = assertionSteps
    .map((step) => assertionStepLine(step, names))
    .join("\n");

  return `import { test } from '../../fixtures/test.fixture';
import { ${names.testDataConst} } from '../../test-data/${names.featureDir}/${names.featureDir}.data';

test.describe(${quote(names.featureName)}, () => {
  test(${quote(title)}, async ({ ${names.actionFixture}, ${names.pageFixture} }) => {
    await ${names.actionFixture}.${names.actionMethod}(${names.testDataConst});
${assertions || "    test.info().annotations.push({ type: 'expected-result', description: 'No explicit assertion step was supplied.' });"}
  });
});
`;
}

function buildTestData(input: TestCaseInput, names: FeatureNames): string {
  const data = JSON.stringify(input.testData, null, 2)
    .split("\n")
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join("\n");

  return `export const ${names.testDataConst} = ${data} as const;

export type ${names.testDataType} = typeof ${names.testDataConst};
`;
}

export function buildPageFixtureFile(names: FeatureNames): GeneratedFile {
  const fixturePath = "fixtures/page.fixture.ts";
  const current = readProjectFile(fixturePath);
  const importLine = `import { ${names.pageClass} } from '../page_objects/${names.featureDir}/${names.pageClass}';`;
  const typeLine = `    ${names.pageFixture}: ${names.pageClass};`;
  const fixtureBlock = `    ${names.pageFixture}: async ({ page }, use) => {
        await use(new ${names.pageClass}(page));
    },`;

  let content = ensureImport(current, importLine);
  content = ensureTypeMember(
    content,
    "PageFixtures",
    names.pageFixture,
    typeLine,
  );
  content = ensureFixtureMember(
    content,
    "PageFixtures",
    names.pageFixture,
    fixtureBlock,
  );

  return { path: fixturePath, content };
}

export function buildActionFixtureFile(names: FeatureNames): GeneratedFile {
  const fixturePath = "fixtures/test.fixture.ts";
  const current = readProjectFile(fixturePath);
  const importLine = `import { ${names.actionClass} } from '../actions/${names.featureDir}/${names.actionClass}';`;
  const typeLine = `    ${names.actionFixture}: ${names.actionClass};`;
  const fixtureBlock = `    ${names.actionFixture}: async ({ page }, use) => {
        await use(new ${names.actionClass}(page));
    },`;

  let content = ensureImport(current, importLine);
  content = ensureTypeMember(
    content,
    "ActionFixtures",
    names.actionFixture,
    typeLine,
  );
  content = ensureFixtureMember(
    content,
    "ActionFixtures",
    names.actionFixture,
    fixtureBlock,
  );

  return { path: fixturePath, content };
}

function actionStepLine(step: TestStepInput, names: FeatureNames): string {
  if (step.action === "login") {
    return "    await this.loginAction.loginAndWaitForLoad();";
  }

  if (step.action === "goto") {
    return `    await this.${names.pageFixture}.goto(${valueExpression(step, "url")});`;
  }

  const targetMethod = toPascalCase(step.target || step.action);

  if (step.action === "fill") {
    return `    await this.${names.pageFixture}.fill${targetMethod}(${valueExpression(step, "value")});`;
  }

  if (step.action === "click") {
    return `    await this.${names.pageFixture}.click${targetMethod}();`;
  }

  if (step.action === "check") {
    return `    await this.${names.pageFixture}.check${targetMethod}();`;
  }

  if (step.action === "select") {
    return `    await this.${names.pageFixture}.select${targetMethod}(${valueExpression(step, "value")});`;
  }

  return "";
}

function assertionStepLine(step: TestStepInput, names: FeatureNames): string {
  if (step.action === "expectUrl") {
    return `    await ${names.pageFixture}.expectPageUrl(${valueExpression(step, "url")});`;
  }

  const targetMethod = toPascalCase(step.target || step.action);

  if (step.action === "expectVisible") {
    return `    await ${names.pageFixture}.expect${targetMethod}Visible();`;
  }

  if (step.action === "expectText") {
    const expected = step.expectedTextKey
      ? `String(${names.testDataConst}.${step.expectedTextKey})`
      : quote(step.expectedText || "");
    return `    await ${names.pageFixture}.expect${targetMethod}Text(${expected});`;
  }

  return "";
}

function valueExpression(step: TestStepInput, field: "value" | "url"): string {
  if (field === "value" && step.valueKey)
    return `String(data.${step.valueKey})`;
  if (field === "url" && step.valueKey) return `String(data.${step.valueKey})`;
  const directValue = field === "url" ? step.url : step.value;
  if (directValue) return quote(directValue);
  return quote("");
}

function collectTargets(steps: TestStepInput[]): TargetInfo[] {
  const targets = new Map<string, TargetInfo>();

  for (const step of steps) {
    if (
      !step.target ||
      step.action === "login" ||
      step.action === "goto" ||
      step.action === "expectUrl"
    )
      continue;

    const key = step.target;
    if (targets.has(key)) continue;

    targets.set(key, {
      name: key,
      propertyName: `${safeIdentifier(key, "element")}Locator`,
      locator: step.locator || fallbackLocator(step),
    });
  }

  return Array.from(targets.values());
}

function candidatePropertyName(target: TargetInfo): string {
  return `${target.propertyName}Candidates`;
}

function locatorCandidateExpressions(target: TargetInfo): string[] {
  const primary = locatorExpression(target.locator);
  const fallback = fallbackCandidateExpressions(target);
  const candidates = shouldPreferKnownCandidates(target)
    ? [...fallback, primary]
    : [primary, ...fallback];
  const unique = Array.from(new Set(candidates));

  return [
    ...unique.filter((candidate) => !candidate.includes("xpath=")),
    ...unique.filter((candidate) => candidate.includes("xpath=")),
  ];
}

function shouldPreferKnownCandidates(target: TargetInfo): boolean {
  const normalizedTarget = target.name.toLowerCase();
  return McpConfig.locatorFallbacks.some((entry) =>
    entry.matchKeywords.every((kw) => normalizedTarget.includes(kw.toLowerCase()))
  );
}

function fallbackCandidateExpressions(target: TargetInfo): string[] {
  const label = target.locator.value || target.locator.name || target.name;
  const normalizedTarget = target.name.toLowerCase();
  const candidates: string[] = [];

  // Check config-driven fallbacks first
  for (const entry of McpConfig.locatorFallbacks) {
    const matches = entry.matchKeywords.every((kw) =>
      normalizedTarget.includes(kw.toLowerCase())
    );
    if (matches) {
      for (const pattern of entry.candidates) {
        let expression = pattern;
        if (pattern.includes("{label}")) {
          expression = pattern.replace(/{label}/g, label);
        }
        candidates.push(expression);
      }
      return candidates;
    }
  }

  // Fallback to default heuristic behaviors if no custom keywords match
  if (target.locator.kind === "role" && target.locator.role === "button") {
    candidates.push(
      `page.getByRole("button", { name: /^${escapeRegExpLiteral(label)}$/i })`,
      `page.locator(${quote(`xpath=//button[normalize-space()="${escapeXpathDouble(label)}"]`)})`,
    );
  } else if (target.locator.kind === "text") {
    candidates.push(
      `page.getByText(${quote(label)}, { exact: true })`,
      `page.locator(${quote(`xpath=//*[normalize-space()="${escapeXpathDouble(label)}"]`)})`,
    );
  }

  return candidates;
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeXpathDouble(value: string): string {
  return value.replace(/"/g, '\\"');
}

function fallbackLocator(step: TestStepInput): LocatorInput {
  if (step.action === "fill") {
    return { kind: "label", value: step.target || "field" };
  }

  if (step.action === "click") {
    return { kind: "role", role: "button", name: step.target || "button" };
  }

  if (step.action === "select") {
    return { kind: "role", role: "combobox", name: step.target || "dropdown" };
  }

  return { kind: "text", value: step.target || "text", exact: true };
}

function locatorExpression(locator: LocatorInput): string {
  if (locator.kind === "role") {
    const role = locator.role || "button";
    const name = locator.name || locator.value || "";
    const exact = locator.exact === false ? "false" : "true";
    return `page.getByRole(${quote(role)}, { name: ${quote(name)}, exact: ${exact} })`;
  }

  if (locator.kind === "label") {
    return `page.getByLabel(${quote(locator.value || locator.name || "")})`;
  }

  if (locator.kind === "placeholder") {
    return `page.getByPlaceholder(${quote(locator.value || locator.name || "")})`;
  }

  if (locator.kind === "testId") {
    return `page.getByTestId(${quote(locator.value || locator.name || "")})`;
  }

  if (locator.kind === "text") {
    const exact = locator.exact === false ? "false" : "true";
    return `page.getByText(${quote(locator.value || locator.name || "")}, { exact: ${exact} })`;
  }

  return `page.locator(${quote(locator.value || "")})`;
}

function ensureImport(content: string, importLine: string): string {
  if (content.includes(importLine)) return content;
  const lines = content.split("\n");
  const lastImportIndex = lines.reduce(
    (lastIndex, line, index) =>
      line.startsWith("import ") ? index : lastIndex,
    -1,
  );
  lines.splice(lastImportIndex + 1, 0, importLine);
  return lines.join("\n");
}

function ensureTypeMember(
  content: string,
  typeName: string,
  memberName: string,
  typeLine: string,
): string {
  if (
    new RegExp(`^[ \\t]*${memberName}\\s*:`, "m").test(stripComments(content))
  )
    return content;
  return content.replace(
    new RegExp(`type ${typeName} = \\{\\n`),
    `type ${typeName} = {\n${typeLine}\n`,
  );
}

function ensureFixtureMember(
  content: string,
  typeName: string,
  fixtureName: string,
  fixtureBlock: string,
): string {
  if (
    new RegExp(`^[ \\t]*${fixtureName}\\s*:\\s*async`, "m").test(
      stripComments(content),
    )
  )
    return content;
  return content.replace(
    new RegExp(`export const test = base\\.extend<${typeName}>\\(\\{\\n`),
    `export const test = base.extend<${typeName}>({\n${fixtureBlock}\n`,
  );
}

function stripComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

function readProjectFile(relativePath: string): string {
  const absolutePath = path.join(repoRoot, relativePath);
  if (fs.existsSync(absolutePath)) {
    return fs.readFileSync(absolutePath, "utf-8");
  }

  if (relativePath === "fixtures/page.fixture.ts") {
    return `import { test as base } from '@playwright/test';

type PageFixtures = {
};

export const test = base.extend<PageFixtures>({
});

export { expect } from '@playwright/test';
`;
  }

  if (relativePath === "fixtures/test.fixture.ts") {
    return `import { test as base } from './page.fixture';

type ActionFixtures = {
};

export const test = base.extend<ActionFixtures>({
});

export { expect } from '@playwright/test';
`;
  }

  throw new Error(`Required project file not found: ${relativePath}`);
}

function isFixtureFile(relativePath: string): boolean {
  return (
    relativePath === "fixtures/page.fixture.ts" ||
    relativePath === "fixtures/test.fixture.ts"
  );
}

function collectInputWarnings(input: TestCaseInput): string[] {
  const warnings: string[] = [];

  for (const step of input.steps) {
    if (step.locator?.kind === "css") {
      warnings.push(
        `Step "${step.action}" for "${step.target}" uses CSS. Prefer role, label, placeholder, text, or test id when available.`,
      );
    }

    if (step.locator?.value?.includes("xpath=")) {
      warnings.push(
        `Step "${step.action}" for "${step.target}" uses XPath and may be flaky.`,
      );
    }

    if (step.locator?.kind === "text" && step.locator.exact === false) {
      warnings.push(
        `Step "${step.action}" for "${step.target}" uses broad text matching. Scope it to a row, dialog, menu, or dropdown panel when possible.`,
      );
    }

    if (!step.locator && step.target && !["login", "goto", "expectUrl"].includes(step.action)) {
      warnings.push(
        `Step "${step.action}" for "${step.target}" has no explicit locator. Generator used a fallback locator; replace it with a real UI locator for production.`,
      );
    }
  }

  return warnings;
}
