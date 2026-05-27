import type { Locator, Page } from '@playwright/test';
import type { LocatorCandidate, LocatorValidationResult, StructuredLocator } from './reconDecisionTypes';

export async function validateLocatorCandidate(page: Page, candidate: LocatorCandidate): Promise<LocatorValidationResult> {
  return validateStructuredLocator(page, candidate.structuredLocator, candidate.locator);
}

export async function validateLocatorExpression(
  page: Page,
  locatorExpression: string,
  knownCandidates: LocatorCandidate[] = []
): Promise<LocatorValidationResult> {
  const knownCandidate = knownCandidates.find((candidate) => candidate.locator === locatorExpression);
  if (knownCandidate) {
    return validateLocatorCandidate(page, knownCandidate);
  }

  const structuredLocator = parseLocatorExpression(locatorExpression);
  if (!structuredLocator) {
    return {
      locator: locatorExpression,
      count: 0,
      isSafe: false,
      reason: 'Unsupported locator expression. The recon engine does not use raw eval.'
    };
  }

  return validateStructuredLocator(page, structuredLocator, locatorExpression);
}

export function locatorFromCandidate(page: Page, candidate: LocatorCandidate): Locator {
  return locatorFromStructured(page, candidate.structuredLocator);
}

export function locatorFromExpression(page: Page, locatorExpression: string, knownCandidates: LocatorCandidate[] = []): Locator | null {
  const knownCandidate = knownCandidates.find((candidate) => candidate.locator === locatorExpression);
  if (knownCandidate) {
    return locatorFromCandidate(page, knownCandidate);
  }

  const structuredLocator = parseLocatorExpression(locatorExpression);
  return structuredLocator ? locatorFromStructured(page, structuredLocator) : null;
}

export function parseLocatorExpression(locatorExpression: string): StructuredLocator | null {
  const trimmed = locatorExpression.trim();

  const roleMatch = trimmed.match(
    /^page\.getByRole\((['"])([^'"]+)\1(?:,\s*\{\s*name:\s*(\/(.+)\/[a-z]*|(['"])(.*?)\5)\s*\})?\)$/
  );
  if (roleMatch?.[2]) {
    return {
      method: 'getByRole',
      role: roleMatch[2],
      name: unescapePattern(roleMatch[4] ?? roleMatch[6]),
      exact: false
    };
  }

  const textMethodMatch = trimmed.match(/^page\.(getByLabel|getByPlaceholder|getByText|getByTestId)\((\/(.+)\/[a-z]*|(['"])(.*?)\4)\)$/);
  if (textMethodMatch?.[1]) {
    const method = textMethodMatch[1] as 'getByLabel' | 'getByPlaceholder' | 'getByText' | 'getByTestId';
    return {
      method,
      text: unescapePattern(textMethodMatch[3] ?? textMethodMatch[5] ?? '') ?? '',
      exact: method === 'getByTestId'
    };
  }

  const locatorMatch = trimmed.match(/^page\.locator\((['"])(.*?)\1\)$/);
  if (locatorMatch?.[2]) {
    const selector = locatorMatch[2];
    if (!isSafeSelector(selector)) {
      return null;
    }

    if (selector.startsWith('xpath=') || selector.startsWith('//') || selector.startsWith('/html/')) {
      return {
        method: 'xpath',
        selector: selector.replace(/^xpath=/, '')
      };
    }

    return {
      method: 'css',
      selector
    };
  }

  return null;
}

async function validateStructuredLocator(
  page: Page,
  structuredLocator: StructuredLocator,
  locatorExpression: string
): Promise<LocatorValidationResult> {
  try {
    const locator = locatorFromStructured(page, structuredLocator);
    const count = await locator.count();
    const first = count > 0 ? locator.first() : null;
    const isVisible = first ? await first.isVisible({ timeout: 750 }).catch(() => false) : undefined;
    const isEnabled = first ? await first.isEnabled({ timeout: 750 }).catch(() => false) : undefined;
    const isSafe = count === 1 && isVisible !== false && isEnabled !== false;

    return {
      locator: locatorExpression,
      count,
      isVisible,
      isEnabled,
      isSafe,
      reason: validationReason(count, isVisible, isEnabled)
    };
  } catch (error) {
    return {
      locator: locatorExpression,
      count: 0,
      isSafe: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

function locatorFromStructured(page: Page, structuredLocator: StructuredLocator): Locator {
  switch (structuredLocator.method) {
    case 'getByRole':
      return structuredLocator.name
        ? page.getByRole(structuredLocator.role as Parameters<Page['getByRole']>[0], {
            name: structuredLocator.exact ? structuredLocator.name : new RegExp(escapeRegex(structuredLocator.name), 'i'),
            exact: structuredLocator.exact
          })
        : page.getByRole(structuredLocator.role as Parameters<Page['getByRole']>[0]);
    case 'getByLabel':
      return page.getByLabel(structuredLocator.exact ? structuredLocator.text : new RegExp(escapeRegex(structuredLocator.text), 'i'), {
        exact: structuredLocator.exact
      });
    case 'getByPlaceholder':
      return page.getByPlaceholder(structuredLocator.exact ? structuredLocator.text : new RegExp(escapeRegex(structuredLocator.text), 'i'), {
        exact: structuredLocator.exact
      });
    case 'getByText':
      return page.getByText(structuredLocator.exact ? structuredLocator.text : new RegExp(escapeRegex(structuredLocator.text), 'i'), {
        exact: structuredLocator.exact
      });
    case 'getByTestId':
      return page.getByTestId(structuredLocator.text);
    case 'css':
      return page.locator(structuredLocator.selector);
    case 'xpath': {
      const selector = structuredLocator.selector.startsWith('xpath=')
        ? structuredLocator.selector
        : `xpath=${structuredLocator.selector}`;
      return page.locator(selector);
    }
  }
}

function validationReason(count: number, isVisible?: boolean, isEnabled?: boolean): string {
  if (count === 0) return 'Locator matched zero elements.';
  if (count > 1) return `Locator matched ${count} elements; strict mode risk.`;
  if (isVisible === false) return 'Locator matched one element, but it is not visible.';
  if (isEnabled === false) return 'Locator matched one element, but it is not enabled.';
  return 'Locator matched exactly one visible enabled element.';
}

function isSafeSelector(selector: string): boolean {
  if (!selector || selector.length > 500) return false;
  if (/javascript:|cookie|localStorage|sessionStorage|Authorization|Bearer\s+/i.test(selector)) return false;
  return true;
}

function unescapePattern(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value.replace(/\\([.*+?^${}()|[\]\\])/g, '$1');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
