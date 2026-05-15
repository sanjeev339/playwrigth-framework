import * as fs from "fs";
import * as path from "path";
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
    .map((target) => `  readonly ${target.propertyName}: Locator;`)
    .join("\n");

  const locatorAssignments = targets
    .map(
      (target) =>
        `    this.${target.propertyName} = ${locatorExpression(target.locator)};`,
    )
    .join("\n");

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
    await expect(this.${target.propertyName}).toBeVisible();
    await this.${target.propertyName}.fill(value);
  }`);
  }

  if (matchingSteps.some((step) => step.action === "click")) {
    methods.push(`  async click${baseName}(): Promise<void> {
    await expect(this.${target.propertyName}).toBeVisible();
    await this.${target.propertyName}.click();
  }`);
  }

  if (matchingSteps.some((step) => step.action === "check")) {
    methods.push(`  async check${baseName}(): Promise<void> {
    await expect(this.${target.propertyName}).toBeVisible();
    await this.${target.propertyName}.check();
  }`);
  }

  if (matchingSteps.some((step) => step.action === "select")) {
    methods.push(`  async select${baseName}(value: string): Promise<void> {
    await expect(this.${target.propertyName}).toBeVisible();
    await this.${target.propertyName}.selectOption(value);
  }`);
  }

  if (matchingSteps.some((step) => step.action === "expectVisible")) {
    methods.push(`  async expect${baseName}Visible(): Promise<void> {
    await expect(this.${target.propertyName}).toBeVisible();
  }`);
  }

  if (matchingSteps.some((step) => step.action === "expectText")) {
    methods.push(`  async expect${baseName}Text(expectedText: string | RegExp): Promise<void> {
    await expect(this.${target.propertyName}).toContainText(expectedText);
  }`);
  }

  return methods;
}

function buildAction(input: TestCaseInput, names: FeatureNames): string {
  const actionSteps = input.steps.filter((step) =>
    ["goto", "fill", "click", "check", "select"].includes(step.action),
  );
  const body = actionSteps
    .map((step) => actionStepLine(step, names))
    .join("\n");

  return `import { Page } from '@playwright/test';
import { ${names.pageClass} } from '../../page_objects/${names.featureDir}/${names.pageClass}';
import { ${names.testDataType} } from '../../test-data/${names.featureDir}/${names.featureDir}.data';
import { Logger } from '../../core/logger/Logger';

export class ${names.actionClass} {
  private readonly ${names.pageFixture}: ${names.pageClass};

  constructor(page: Page) {
    this.${names.pageFixture} = new ${names.pageClass}(page);
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

function buildPageFixtureFile(names: FeatureNames): GeneratedFile {
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

function buildActionFixtureFile(names: FeatureNames): GeneratedFile {
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
    if (!step.target || step.action === "goto" || step.action === "expectUrl")
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

function fallbackLocator(step: TestStepInput): LocatorInput {
  if (step.action === "fill") {
    return { kind: "label", value: step.target || "field" };
  }

  if (step.action === "click") {
    return { kind: "role", role: "button", name: step.target || "button" };
  }

  return { kind: "text", value: step.target || "text" };
}

function locatorExpression(locator: LocatorInput): string {
  if (locator.kind === "role") {
    const role = locator.role || "button";
    const name = locator.name || locator.value || "";
    const exact = locator.exact === false ? ", exact: false" : "";
    return `page.getByRole(${quote(role)}, { name: ${quote(name)}${exact} })`;
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
    const exact = locator.exact === false ? ", { exact: false }" : "";
    return `page.getByText(${quote(locator.value || locator.name || "")}${exact})`;
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
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
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
  }

  return warnings;
}
