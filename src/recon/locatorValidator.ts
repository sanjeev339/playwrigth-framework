import path from 'node:path';
import type { LocatorValidationReport, LocatorValidationWarning } from '../types';
import { listFiles, readTextFile, resolveFromRoot, writeJsonFile } from '../utils/fileUtils';
import { logger } from '../utils/logger';

const locatorRegex =
  /page\.(getBy(?:Role|Label|Placeholder|Text|TestId)\([^;\n]+?\)|locator\([^;\n]+?\))/g;
const genericText = /^(add|edit|delete|save|submit|cancel|ok|yes|no|next|back|close|login|search)$/i;

export async function validateGeneratedLocators(options: {
  generatedDir?: string;
  outputPath?: string;
} = {}): Promise<LocatorValidationReport> {
  const generatedDir = options.generatedDir ?? resolveFromRoot('tests', 'generated');
  const outputPath = options.outputPath ?? resolveFromRoot('reports', 'locator-validation.json');
  const testFiles = await listFiles(generatedDir, '.ts');
  const report: LocatorValidationReport = {
    generated_at: new Date().toISOString(),
    files: [],
    warnings: []
  };

  for (const file of testFiles) {
    const code = await readTextFile(file);
    const locators = extractLocators(code);
    const warnings = validateFile(file, code, locators);
    report.files.push({
      file: path.relative(process.cwd(), file),
      locators,
      warnings
    });
    report.warnings.push(...warnings);
  }

  await writeJsonFile(outputPath, report);
  logger.info(`Wrote locator validation report -> ${outputPath}`);
  return report;
}

function extractLocators(code: string): string[] {
  const matches = code.match(locatorRegex) ?? [];
  return [...new Set(matches)];
}

function validateFile(file: string, code: string, locators: string[]): LocatorValidationWarning[] {
  const warnings: LocatorValidationWarning[] = [];
  const relativeFile = path.relative(process.cwd(), file);

  if (!/expect\s*\(/.test(code)) {
    warnings.push({
      file: relativeFile,
      severity: 'high',
      rule: 'missing-expect',
      message: 'Generated test does not contain any expect assertions.'
    });
  }

  if (/LOGIN_PASSWORD/.test(code) && /LOGIN_PASSWORD\s*=\s*['"`]/.test(code)) {
    warnings.push({
      file: relativeFile,
      severity: 'high',
      rule: 'hardcoded-login-password',
      message: 'Potential hardcoded LOGIN_PASSWORD assignment detected.'
    });
  }

  if (/\.fill\(\s*['"`][^'"`]{4,}['"`]\s*\)/.test(code) && /password/i.test(code) && !/process\.env\.LOGIN_PASSWORD/.test(code)) {
    warnings.push({
      file: relativeFile,
      severity: 'high',
      rule: 'hardcoded-credential-fill',
      message: 'A password-like fill appears to use a literal value instead of process.env.LOGIN_PASSWORD.'
    });
  }

  for (const locator of locators) {
    if (/getByText/.test(locator)) {
      const text = firstStringArgument(locator);
      if (!text || text.length <= 3 || genericText.test(text)) {
        warnings.push({
          file: relativeFile,
          severity: 'medium',
          rule: 'generic-get-by-text',
          message: 'getByText locator uses short or generic text and may match multiple elements.',
          locator
        });
      }
    }

    if (/locator\(\s*['"`](xpath=|\/\/)/.test(locator)) {
      warnings.push({
        file: relativeFile,
        severity: 'medium',
        rule: 'xpath-fallback',
        message: 'XPath locator detected. Prefer role, label, placeholder, or test-id locators when available.',
        locator
      });
    }

    if (/locator\(\s*['"`](button|input|div|span|a)['"`]\s*\)/.test(locator)) {
      warnings.push({
        file: relativeFile,
        severity: 'medium',
        rule: 'broad-css-locator',
        message: 'Broad CSS locator is likely to match multiple elements.',
        locator
      });
    }
  }

  return warnings;
}

function firstStringArgument(locator: string): string | null {
  const match = locator.match(/\(\s*['"`]([^'"`]+)['"`]/);
  if (match?.[1]) {
    return match[1];
  }

  const regexMatch = locator.match(/\(\s*\/(.+?)\/[a-z]*/);
  return regexMatch?.[1]?.replace(/\\(.)/g, '$1') ?? null;
}

if (require.main === module) {
  validateGeneratedLocators()
    .then((report) => {
      logger.info(`Locator validation completed with ${report.warnings.length} warning(s).`);
    })
    .catch((error) => {
      logger.error('Locator validation failed.', error);
      process.exitCode = 1;
    });
}
