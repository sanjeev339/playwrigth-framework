import type { ReconAction } from './reconActionExtractor';
import type { ScenarioStep, ReconSnapshot } from '../types';
import { callLLM } from '../llm/llmClient';
import { logger } from '../utils/logger';
import { readJsonFile } from '../utils/fileUtils';
import * as path from 'path';

export interface AssertionCandidate {
  type: 'url' | 'landmark' | 'locator_visible' | 'input_value' | 'custom' | 'network_no_error';
  assertionCode: string;
}

export function escapeRegexForLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '\\/');
}

export function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function isStableUrlSegment(segment: string): boolean {
  if (!segment || isUuidLike(segment)) {
    return false;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(segment)) {
    return false;
  }
  return /[a-z]/i.test(segment);
}

export function urlAssertionFromPostActionUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/').filter(Boolean);
    const stableSegment = [...segments].reverse().find((segment) => isStableUrlSegment(segment));
    if (!stableSegment) {
      return null;
    }
    const escaped = escapeRegexForLiteral(stableSegment);
    return `await expect(page).toHaveURL(/${escaped}/i, { timeout: 15000 });`;
  } catch {
    return null;
  }
}

/**
 * Extract assertions for a given action, using both structural logic and LLM translation of expected results.
 */
export async function extractStepAssertions(
  action: ReconAction,
  step: ScenarioStep,
  payload: Record<string, unknown>,
  context?: {
    stableRowLocator?: string | null;
    resolvedLocator?: string | null;
  }
): Promise<AssertionCandidate[]> {
  const candidates: AssertionCandidate[] = [];

  if (context?.stableRowLocator) {
    candidates.push({
      type: 'locator_visible',
      assertionCode: `await expect(${context.stableRowLocator}).toBeVisible({ timeout: 15000 });`
    });
  }

  // 1. Structural URL Assertions
  const urlAssertion = urlAssertionFromPostActionUrl(action.postActionUrl);
  if (urlAssertion) {
    candidates.push({ type: 'url', assertionCode: urlAssertion });
  }

  // 2. Landmark assertions
  if (action.postActionLandmarkLocator) {
    candidates.push({
      type: 'landmark',
      assertionCode: `await expect(${action.postActionLandmarkLocator}).toBeVisible({ timeout: 15000 });`
    });
  }

  // 3. Form Input Persistence
  const fillLocator = context?.resolvedLocator || action.selectedLocator;
  if (action.actionType === 'fill' && fillLocator) {
    let valExpr = "''";
    if (action.target && payload[action.target] !== undefined) {
      valExpr = `String(payload[${JSON.stringify(action.target)}])`;
    } else if (action.value) {
      valExpr = JSON.stringify(action.value);
    }
    candidates.push({
      type: 'input_value',
      assertionCode: `await expect(${fillLocator}).toHaveValue(${valExpr});`
    });
  }

  // 4. Element Visibility (fallback for clicks/navigates)
  const visibilityLocator = context?.resolvedLocator || action.selectedLocator;
  if (visibilityLocator && action.actionStatus === 'success' && action.actionType !== 'fill' && !urlAssertion && !action.postActionLandmarkLocator) {
    candidates.push({
      type: 'locator_visible',
      assertionCode: `await expect(${visibilityLocator}).toBeVisible({ timeout: 15000 });`
    });
  }

  // 5. LLM-translated Expected Results
  if (step && step.expected_result) {
    // If we already have a strong postcondition signal (URL or landmark), prefer those over
    // LLM-translated expected-result assertions, which can become flaky when UIs change.
    if (!urlAssertion && !action.postActionLandmarkLocator) {
      try {
        const customAssertions = await translateExpectedResultToAssertions(step.expected_result, action, payload);
        for (const assertion of customAssertions) {
          const stabilized = ensureStableAssertionTimeout(assertion);
          if (!candidates.some((c) => c.assertionCode.trim() === stabilized.trim())) {
            candidates.push({
              type: 'custom',
              assertionCode: stabilized
            });
          }
        }
      } catch (e) {
        logger.warn(`Failed to translate expected_result for step ${action.stepNo}: ${e}`);
      }
    }
  }

  // Load snapshot if available to perform assertion gating
  let snapshot: ReconSnapshot | null = null;
  if (action.snapshotFile) {
    try {
      const absolutePath = path.resolve(process.cwd(), action.snapshotFile);
      snapshot = await readJsonFile<ReconSnapshot>(absolutePath);
    } catch (e) {
      logger.warn(`Failed to read post-action snapshot file: ${action.snapshotFile}. Error: ${e}`);
    }
  }

  if (snapshot) {
    const gatedCandidates: AssertionCandidate[] = [];
    for (const candidate of candidates) {
      if (candidate.type === 'url') {
        gatedCandidates.push(candidate);
        continue;
      }

      const locatorStr = extractLocatorFromExpect(candidate.assertionCode);
      if (!locatorStr) {
        gatedCandidates.push(candidate);
        continue;
      }

      const exists = doesLocatorExistInSnapshot(locatorStr, snapshot);
      if (exists) {
        gatedCandidates.push(candidate);
      } else {
        logger.info(`Gated/discarded assertion candidate due to missing element: ${candidate.assertionCode}`);
      }
    }
    return gatedCandidates;
  }

  return candidates;
}

export function extractLocatorFromExpect(assertionCode: string): string | null {
  const expectIdx = assertionCode.indexOf('expect(');
  if (expectIdx === -1) {
    return null;
  }
  const startIdx = expectIdx + 'expect('.length;
  let parenCount = 1;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let content = '';
  for (let i = startIdx; i < assertionCode.length; i++) {
    const char = assertionCode[i];
    const prevChar = i > startIdx ? assertionCode[i - 1] : '';

    if (prevChar !== '\\') {
      if (char === "'" && !inDoubleQuote && !inBacktick) {
        inSingleQuote = !inSingleQuote;
      } else if (char === '"' && !inSingleQuote && !inBacktick) {
        inDoubleQuote = !inDoubleQuote;
      } else if (char === '`' && !inSingleQuote && !inDoubleQuote) {
        inBacktick = !inBacktick;
      }
    }

    if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
      if (char === '(') {
        parenCount++;
      } else if (char === ')') {
        parenCount--;
        if (parenCount === 0) {
          break;
        }
      }
    }
    content += char;
  }
  
  content = content.trim();
  if (content.startsWith('page.')) {
    return content;
  }
  return null;
}

function normalizeLocatorString(str: string): string {
  return str
    .replace(/\s+/g, '') // remove all whitespace
    .replace(/"/g, "'") // convert double quotes to single quotes
    .replace(/`/g, "'") // convert backticks to single quotes
    .toLowerCase();
}

function parsePattern(match: RegExpMatchArray | null): { pattern: string | null; isRegex: boolean } {
  if (!match) {
    return { pattern: null, isRegex: false };
  }
  if (match[1] !== undefined) {
    return { pattern: match[1], isRegex: true };
  }
  if (match[2] !== undefined) {
    return { pattern: match[2], isRegex: false };
  }
  return { pattern: null, isRegex: false };
}

function matchesPattern(value: string | null | undefined, pattern: string | null | undefined, isRegex: boolean): boolean {
  if (!value) return false;
  if (!pattern) return false;
  if (isRegex) {
    try {
      const regex = new RegExp(pattern, 'i');
      return regex.test(value);
    } catch {
      return value.toLowerCase().includes(pattern.toLowerCase());
    }
  }
  return value.toLowerCase().includes(pattern.toLowerCase());
}

export function doesLocatorExistInSnapshot(locatorStr: string, snapshot: ReconSnapshot): boolean {
  if (!snapshot.elements || snapshot.elements.length === 0) {
    return false;
  }

  // 1. Direct match check on locatorPriority or suggestedLocator (normalized)
  const normalizedProposed = normalizeLocatorString(locatorStr);
  for (const element of snapshot.elements) {
    if (!element.isVisible) {
      continue;
    }
    if (element.suggestedLocator) {
      if (normalizeLocatorString(element.suggestedLocator) === normalizedProposed) {
        return true;
      }
    }
    if (element.locatorPriority) {
      for (const loc of element.locatorPriority) {
        if (normalizeLocatorString(loc) === normalizedProposed) {
          return true;
        }
      }
    }
  }

  // 2. Fallback structured matching
  // a) getByRole
  const roleMatch = locatorStr.match(/getByRole\(\s*['"`]([^'"`]+)['"`]/);
  if (roleMatch) {
    const role = roleMatch[1].toLowerCase();
    const nameMatch = locatorStr.match(/name:\s*(?:\/(.+)\/[a-z]*|['"`]([^'"`]+)['"`])/);
    const { pattern: namePattern, isRegex: nameIsRegex } = parsePattern(nameMatch);

    // Find any visible element with this role and name
    for (const element of snapshot.elements) {
      if (!element.isVisible) {
        continue;
      }
      const elementRole = (element.role || '').toLowerCase();
      const elementTag = (element.tag || '').toLowerCase();
      
      const roleMatches = elementRole === role || elementTag === role || 
                         (role === 'textbox' && elementTag === 'input') ||
                         (role === 'button' && elementTag === 'button');
      if (!roleMatches) {
        continue;
      }

      if (namePattern) {
        const matchesName = matchesPattern(element.name, namePattern, nameIsRegex) ||
                            matchesPattern(element.text, namePattern, nameIsRegex) ||
                            matchesPattern(element.ariaLabel, namePattern, nameIsRegex) ||
                            matchesPattern(element.label, namePattern, nameIsRegex) ||
                            matchesPattern(element.title, namePattern, nameIsRegex);
        if (matchesName) {
          return true;
        }
      } else {
        return true;
      }
    }
    return false;
  }

  // b) getByText
  const textMatch = locatorStr.match(/getByText\(\s*(?:\/(.+)\/[a-z]*|['"`]([^'"`]+)['"`])/);
  if (textMatch) {
    const { pattern: textPattern, isRegex: textIsRegex } = parsePattern(textMatch);
    if (textPattern) {
      for (const element of snapshot.elements) {
        if (!element.isVisible) {
          continue;
        }
        if (matchesPattern(element.text, textPattern, textIsRegex)) {
          return true;
        }
      }
    }
    return false;
  }

  // c) getByLabel
  const labelMatch = locatorStr.match(/getByLabel\(\s*(?:\/(.+)\/[a-z]*|['"`]([^'"`]+)['"`])/);
  if (labelMatch) {
    const { pattern: labelPattern, isRegex: labelIsRegex } = parsePattern(labelMatch);
    if (labelPattern) {
      for (const element of snapshot.elements) {
        if (!element.isVisible) {
          continue;
        }
        if (matchesPattern(element.label, labelPattern, labelIsRegex) || 
            matchesPattern(element.ariaLabel, labelPattern, labelIsRegex)) {
          return true;
        }
      }
    }
    return false;
  }

  // d) getByPlaceholder
  const placeholderMatch = locatorStr.match(/getByPlaceholder\(\s*(?:\/(.+)\/[a-z]*|['"`]([^'"`]+)['"`])/);
  if (placeholderMatch) {
    const { pattern: placeholderPattern, isRegex: placeholderIsRegex } = parsePattern(placeholderMatch);
    if (placeholderPattern) {
      for (const element of snapshot.elements) {
        if (!element.isVisible) {
          continue;
        }
        if (matchesPattern(element.placeholder, placeholderPattern, placeholderIsRegex)) {
          return true;
        }
      }
    }
    return false;
  }

  // e) getByTestId
  const testIdMatch = locatorStr.match(/getByTestId\(\s*['"`]([^'"`]+)['"`]/);
  if (testIdMatch) {
    const testId = testIdMatch[1];
    for (const element of snapshot.elements) {
      if (!element.isVisible) {
        continue;
      }
      if (element.dataTestId === testId || element.dataTest === testId || 
          element.dataCy === testId || element.dataQa === testId || element.id === testId) {
        return true;
      }
    }
    return false;
  }

  // f) Chained filter matching
  const filterMatch = locatorStr.match(/filter\(\s*\{\s*hasText:\s*(?:\/(.+)\/[a-z]*|['"`]([^'"`]+)['"`])\s*\}\s*\)/);
  if (filterMatch) {
    const { pattern: filterPattern, isRegex: filterIsRegex } = parsePattern(filterMatch);
    if (filterPattern) {
      const baseRoleMatch = locatorStr.match(/getByRole\(\s*['"`]([^'"`]+)['"`]/);
      const baseRole = baseRoleMatch ? baseRoleMatch[1].toLowerCase() : null;

      for (const element of snapshot.elements) {
        if (!element.isVisible) {
          continue;
        }
        if (baseRole) {
          const elementRole = (element.role || '').toLowerCase();
          const elementTag = (element.tag || '').toLowerCase();
          if (elementRole !== baseRole && elementTag !== baseRole) {
            continue;
          }
        }
        if (matchesPattern(element.text, filterPattern, filterIsRegex)) {
          return true;
        }
      }
    }
    return false;
  }

  // g) Generic css/xpath locator matching
  const selectorMatch = locatorStr.match(/locator\(\s*['"`]([^'"`]+)['"`]/);
  if (selectorMatch) {
    const selector = selectorMatch[1];
    for (const element of snapshot.elements) {
      if (!element.isVisible) {
        continue;
      }
      if (element.id === selector || element.className === selector || 
          element.cssCandidate === selector || element.xpathCandidate === selector) {
        return true;
      }
    }
    return false;
  }

  return true;
}

function ensureStableAssertionTimeout(assertion: string): string {
  const trimmed = assertion.trim();
  if (!trimmed.startsWith('await expect(') || !trimmed.endsWith(';')) {
    return assertion;
  }

  // If the generator already supplied a timeout, do not double-apply.
  if (/\{\s*timeout\s*:\s*\d+/.test(trimmed)) {
    return assertion;
  }

  if (/\.toBeVisible\(\s*\)\s*;$/m.test(trimmed)) {
    return trimmed.replace(/\.toBeVisible\(\s*\)\s*;$/m, '.toBeVisible({ timeout: 15000 });');
  }

  if (/\.toBeHidden\(\s*\)\s*;$/m.test(trimmed)) {
    return trimmed.replace(/\.toBeHidden\(\s*\)\s*;$/m, '.toBeHidden({ timeout: 15000 });');
  }

  if (/\.toHaveText\([\s\S]*\)\s*;$/m.test(trimmed)) {
    return trimmed.replace(/\)\s*;$/m, ', { timeout: 15000 });');
  }

  if (/\.toContainText\([\s\S]*\)\s*;$/m.test(trimmed)) {
    return trimmed.replace(/\)\s*;$/m, ', { timeout: 15000 });');
  }

  return assertion;
}

async function translateExpectedResultToAssertions(
  expectedResult: string,
  action: ReconAction,
  payload: Record<string, unknown>
): Promise<string[]> {
  const prompt = `You are a Playwright test assistant. Translate the following English expected result into one or more Playwright assertions.
Expected Result: "${expectedResult}"
Current Step Details:
- Action type: ${action.actionType}
- Target: ${action.target}
- Selected locator: ${action.selectedLocator}
- Post action URL: ${action.postActionUrl}
- Post action landmark: ${action.postActionLandmarkLocator}
- Scenario payload: ${JSON.stringify(payload)}

Guidelines:
1. Generate valid, clean Playwright TypeScript assertion statements (e.g. "await expect(page).toHaveURL(/.../);" or "await expect(page.getByText(...)).toBeVisible();").
2. Only output the Playwright code lines. One assertion statement per line.
3. Do not wrap in test.step or anything else. Just the await expect(...) lines.
4. If a statement needs to reference the payload values, use the payload object directly (e.g., payload["Email Address"] or String(payload["Email Address"])).
5. Return only the assertions, nothing else. No markdown formatting.`;

  try {
    const response = await callLLM(prompt);
    return response
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('await expect(') && line.endsWith(';'));
  } catch (error) {
    logger.warn('Failed to translate expected result to assertions with LLM, falling back.', error);
    return [];
  }
}
