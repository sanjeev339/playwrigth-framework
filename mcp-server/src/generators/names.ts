export type FeatureNames = {
  featureName: string;
  featureDir: string;
  classBase: string;
  pageClass: string;
  actionClass: string;
  pageFixture: string;
  actionFixture: string;
  testDataConst: string;
  testDataType: string;
  actionMethod: string;
};

const RESERVED_WORDS = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

export function toWords(value: string): string[] {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

export function toPascalCase(value: string, fallback = "Generated"): string {
  const pascal = toWords(value)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
  return pascal || fallback;
}

export function toCamelCase(value: string, fallback = "generated"): string {
  const pascal = toPascalCase(value, toPascalCase(fallback));
  const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1);
  return RESERVED_WORDS.has(camel) ? `${camel}Value` : camel;
}

export function toKebabCase(value: string, fallback = "generated-feature"): string {
  const kebab = toWords(value)
    .map((word) => word.toLowerCase())
    .join("-");
  return kebab || fallback;
}

export function toConstantCase(value: string, fallback = "GENERATED_FEATURE"): string {
  const constant = toWords(value)
    .map((word) => word.toUpperCase())
    .join("_");
  return constant || fallback;
}

export function createFeatureNames(
  featureName: string,
  title: string,
): FeatureNames {
  const safeFeatureName = featureName?.trim() || "Generated Feature";
  const safeTitle = title?.trim() || "Generated Scenario";
  const classBase = toPascalCase(safeFeatureName, "GeneratedFeature");
  const fixtureBase = toCamelCase(safeFeatureName, "generatedFeature");

  return {
    featureName: safeFeatureName,
    featureDir: toKebabCase(safeFeatureName),
    classBase,
    pageClass: `${classBase}Page`,
    actionClass: `${classBase}Action`,
    pageFixture: `${fixtureBase}Page`,
    actionFixture: `${fixtureBase}Action`,
    testDataConst: `${toConstantCase(safeFeatureName)}_TEST_DATA`,
    testDataType: `${classBase}TestData`,
    actionMethod: `perform${toPascalCase(safeTitle, "GeneratedScenario")}`,
  };
}

export function safeIdentifier(value: string, fallback: string): string {
  return toCamelCase(value, fallback);
}

export function quote(value: string): string {
  return JSON.stringify(value);
}
