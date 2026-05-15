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

export function toWords(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

export function toPascalCase(value: string): string {
  return toWords(value)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

export function toCamelCase(value: string): string {
  const pascal = toPascalCase(value);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function toKebabCase(value: string): string {
  return toWords(value)
    .map((word) => word.toLowerCase())
    .join("-");
}

export function toConstantCase(value: string): string {
  return toWords(value)
    .map((word) => word.toUpperCase())
    .join("_");
}

export function createFeatureNames(
  featureName: string,
  title: string,
): FeatureNames {
  const classBase = toPascalCase(featureName);

  return {
    featureName,
    featureDir: toKebabCase(featureName),
    classBase,
    pageClass: `${classBase}Page`,
    actionClass: `${classBase}Action`,
    pageFixture: `${toCamelCase(featureName)}Page`,
    actionFixture: `${toCamelCase(featureName)}Action`,
    testDataConst: `${toConstantCase(featureName)}_TEST_DATA`,
    testDataType: `${classBase}TestData`,
    actionMethod: `perform${toPascalCase(title)}`,
  };
}

export function safeIdentifier(value: string, fallback: string): string {
  const identifier = toCamelCase(value);
  return identifier || fallback;
}

export function quote(value: string): string {
  return JSON.stringify(value);
}
