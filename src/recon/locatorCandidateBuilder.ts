import type { DomElementSnapshot } from '../types';
import type { StructuredLocator } from './reconDecisionTypes';

const dynamicIdPatterns = [
  /^pr_id_/i,
  /^react-select-/i,
  /^\d+$/,
  /^[a-f0-9]{12,}$/i,
  /^[A-Za-z]+-[a-f0-9]{8,}$/i,
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i
];

/** Heuristic classification for LLM prompts — not a guarantee of runtime behavior. */
export function inferUiStability(element: DomElementSnapshot): 'transient' | 'stable' | 'unknown' {
  const role = (element.role || '').trim().toLowerCase();
  if (role === 'alert' || role === 'status') {
    return 'transient';
  }

  const live = (element.ariaLive || '').trim().toLowerCase();
  if (live === 'polite' || live === 'assertive') {
    return 'transient';
  }

  const haystack = `${element.className ?? ''} ${element.dataTestId ?? ''}`.toLowerCase();
  const transientHints = ['toast', 'snackbar', 'sonner', 'notistack', 'react-hot-toast', 'mantine-notification'];
  if (transientHints.some((hint) => haystack.includes(hint))) {
    return 'transient';
  }

  return 'unknown';
}

export function addLocatorCandidates(elements: DomElementSnapshot[]): DomElementSnapshot[] {
  return elements.map((element) => {
    const structuredLocatorPriority = buildStructuredLocatorPriority(element);
    const locatorPriority = structuredLocatorPriority.map(locatorToString);
    const uiStability = element.uiStability ?? inferUiStability(element);

    return {
      ...element,
      suggestedLocator: locatorPriority[0],
      locatorPriority,
      structuredLocatorPriority,
      uiStability
    };
  });
}

export function buildLocatorPriority(element: DomElementSnapshot): string[] {
  return buildStructuredLocatorPriority(element).map(locatorToString);
}

export function buildStructuredLocatorPriority(element: DomElementSnapshot): StructuredLocator[] {
  const candidates: StructuredLocator[] = [];
  const testId = firstNonEmpty(element.dataTestId, element.dataTest, element.dataCy, element.dataQa);

  if (testId) {
    if (element.dataTestId) {
      candidates.push({ method: 'getByTestId', text: testId, exact: true });
    } else {
      const attr = element.dataTest ? 'data-test' : element.dataCy ? 'data-cy' : 'data-qa';
      candidates.push({ method: 'css', selector: `[${attr}="${cssEscape(testId)}"]` });
    }
  }

  const accessibleName = firstNonEmpty(element.ariaLabel, element.text, element.label, element.placeholder, element.title);
  const role = normalizeRole(element.role || inferRole(element));
  if (role && accessibleName && accessibleName.length <= 80) {
    candidates.push({ method: 'getByRole', role, name: cleanText(accessibleName), exact: false });
  }

  if (element.label) {
    candidates.push({ method: 'getByLabel', text: cleanText(element.label), exact: false });
  }

  if (element.placeholder) {
    candidates.push({ method: 'getByPlaceholder', text: cleanText(element.placeholder), exact: false });
  }

  if (element.text && element.text.length <= 80) {
    candidates.push({ method: 'getByText', text: cleanText(element.text), exact: false });
  }

  if (element.name && isStableIdentifier(element.name)) {
    candidates.push({ method: 'css', selector: `[name="${cssEscape(element.name)}"]` });
  }

  if (element.id && isStableIdentifier(element.id)) {
    candidates.push({ method: 'css', selector: `#${cssEscape(element.id)}` });
  }

  if (element.cssCandidate) {
    candidates.push({ method: 'css', selector: element.cssCandidate });
  }

  if (element.xpathCandidate) {
    candidates.push({ method: 'xpath', selector: element.xpathCandidate });
  }

  return dedupeStructuredLocators(candidates);
}

export function isStableIdentifier(value: string): boolean {
  if (!value || value.length > 64) {
    return false;
  }

  return !dynamicIdPatterns.some((pattern) => pattern.test(value));
}

function normalizeRole(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.trim().toLowerCase();
}

function inferRole(element: DomElementSnapshot): string | undefined {
  const tag = element.tag.toLowerCase();
  const type = element.type?.toLowerCase();

  if (tag === 'button') return 'button';
  if (tag === 'a' && element.href) return 'link';
  if (tag === 'select') return 'combobox';
  if (tag === 'option') return 'option';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') {
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (['button', 'submit', 'reset'].includes(type ?? '')) return 'button';
    return 'textbox';
  }

  return undefined;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => Boolean(value?.trim()));
}

export function locatorToString(locator: StructuredLocator): string {
  switch (locator.method) {
    case 'getByRole':
      return locator.name
        ? `page.getByRole(${quote(locator.role)}, { name: ${regex(locator.name)} })`
        : `page.getByRole(${quote(locator.role)})`;
    case 'getByLabel':
      return `page.getByLabel(${regex(locator.text)})`;
    case 'getByPlaceholder':
      return `page.getByPlaceholder(${regex(locator.text)})`;
    case 'getByText':
      return `page.getByText(${regex(locator.text)})`;
    case 'getByTestId':
      return `page.getByTestId(${quote(locator.text)})`;
    case 'css':
      return `page.locator(${quote(locator.selector)})`;
    case 'xpath': {
      const selector = locator.selector.startsWith('xpath=') ? locator.selector : `xpath=${locator.selector}`;
      return `page.locator(${quote(selector)})`;
    }
  }
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function regex(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return `/${escapeRegex(trimmed)}/i`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function cleanText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function dedupeStructuredLocators(locators: StructuredLocator[]): StructuredLocator[] {
  const seen = new Set<string>();
  const deduped: StructuredLocator[] = [];

  for (const locator of locators) {
    const key = locatorToString(locator);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(locator);
    }
  }

  return deduped;
}
