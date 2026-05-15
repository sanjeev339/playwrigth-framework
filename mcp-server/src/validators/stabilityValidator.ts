export type GeneratedFile = {
  path: string;
  content: string;
};

export type StabilityIssue = {
  severity: "error" | "warning";
  file: string;
  rule: string;
  message: string;
};

type Rule = {
  id: string;
  severity: "error" | "warning";
  pattern: RegExp;
  message: string;
  appliesTo?: (file: GeneratedFile) => boolean;
};

const rules: Rule[] = [
  {
    id: "no-hard-sleep",
    severity: "error",
    pattern: /waitForTimeout\s*\(/,
    message:
      "Do not use waitForTimeout. Wait for a locator, URL, response, or assertion instead.",
  },
  {
    id: "avoid-xpath",
    severity: "error",
    pattern: /locator\s*\(\s*['"`]xpath=/,
    message:
      "Avoid XPath locators in generated framework code unless no stable strategy exists.",
  },
  {
    id: "avoid-first-heading",
    severity: "error",
    pattern: /locator\s*\(\s*['"`]h1['"`]\s*\)\.first\s*\(/,
    message: "Do not use h1.first(). Use a named heading locator instead.",
  },
  {
    id: "no-direct-page-in-spec",
    severity: "error",
    pattern:
      /\bpage\.(goto|locator|click|fill|press|check|selectOption)\s*\(|async\s*\(\s*\{\s*page\s*[},]|\bnew\s+\w+Action\s*\(\s*page\s*\)/,
    message:
      "Specs should use fixtures, actions, and page objects instead of direct page operations.",
    appliesTo: (file) => file.path.endsWith(".spec.ts"),
  },
  {
    id: "no-generated-class-imports-in-spec",
    severity: "error",
    pattern: /from\s+['"`]\.\.\/\.\.\/(?:actions|page_objects)\//,
    message:
      "Specs should consume generated action/page fixtures instead of importing generated classes directly.",
    appliesTo: (file) => file.path.endsWith(".spec.ts"),
  },
  {
    id: "no-page-property-in-spec",
    severity: "error",
    pattern: /\.page\b/,
    message:
      "Specs should not access a Page object directly or through action/page internals.",
    appliesTo: (file) => file.path.endsWith(".spec.ts"),
  },
  {
    id: "no-default-basepage-import",
    severity: "error",
    pattern: /import\s+BasePage\s+from\s+['"`].*BasePage['"`]/,
    message: "BasePage is a named export. Use import { BasePage } from '../../core/base/BasePage'.",
  },
  {
    id: "no-default-loginaction-import",
    severity: "error",
    pattern: /import\s+LoginAction\s+from\s+['"`].*LoginAction['"`]/,
    message: "LoginAction is a named export. Use import { LoginAction } from '../../actions/auth/LoginAction'.",
  },
  {
    id: "no-default-test-import",
    severity: "error",
    pattern: /import\s+test\s+from\s+['"`].*fixtures\/test\.fixture['"`]/,
    message: "The test fixture is a named export. Use import { test } from '../../fixtures/test.fixture'.",
    appliesTo: (file) => file.path.endsWith(".spec.ts"),
  },
  {
    id: "no-static-loginaction",
    severity: "error",
    pattern: /LoginAction\.loginAndWaitForLoad\s*\(/,
    message: "LoginAction is not static. Instantiate it with the Playwright Page and call this.loginAction.loginAndWaitForLoad().",
  },
  {
    id: "no-env-outside-config",
    severity: "error",
    pattern: /process\.env\./,
    message:
      "Environment access must stay in core/config. Generated code should consume test data/config.",
    appliesTo: (file) => !file.path.includes("core/config/"),
  },
  {
    id: "spec-needs-assertion",
    severity: "error",
    pattern: /^((?!expect\s*\(|\.expect[A-Z]).)*$/s,
    message:
      "Generated spec has no expect() assertion. Add an expected result step.",
    appliesTo: (file) => file.path.endsWith(".spec.ts"),
  },
  {
    id: "css-locator-review",
    severity: "warning",
    pattern: /page\.locator\s*\(/,
    message:
      "CSS locator generated. Prefer role, label, placeholder, text, or test id when available.",
  },
];

export function validateGeneratedFiles(
  files: GeneratedFile[],
): StabilityIssue[] {
  const issues: StabilityIssue[] = [];

  for (const file of files) {
    for (const rule of rules) {
      if (rule.appliesTo && !rule.appliesTo(file)) continue;
      if (!rule.pattern.test(file.content)) continue;

      issues.push({
        severity: rule.severity,
        file: file.path,
        rule: rule.id,
        message: rule.message,
      });
    }
  }

  return issues;
}

export function hasBlockingIssues(issues: StabilityIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}
