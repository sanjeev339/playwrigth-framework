import type { Page } from '@playwright/test';
import { getLocatorPolicy } from '../config/env';
import type { DomElementSnapshot } from '../types';
import { buildStructuredLocatorPriority, locatorToString } from './locatorCandidateBuilder';
import type { LocatorCandidate, ParsedAction, StructuredLocator } from './reconDecisionTypes';

const actionLocatorPreference: Record<string, number> = {
  getByTestId: 1,
  getByRole: 2,
  getByLabel: 3,
  getByPlaceholder: 4,
  getByText: 5,
  css: 8,
  xpath: 9
};

export async function resolveDeterministicCandidates(
  _page: Page,
  parsedAction: ParsedAction,
  snapshotElements: DomElementSnapshot[]
): Promise<LocatorCandidate[]> {
  if (!parsedAction.target || parsedAction.target === '__FORM__') {
    return [];
  }

  if (!['navigate', 'click', 'fill', 'select', 'row_action'].includes(parsedAction.actionType)) {
    return [];
  }

  const candidates: LocatorCandidate[] = [];
  candidates.push(...buildExactTargetCandidates(parsedAction));
  candidates.push(...buildRowActionMenuCandidates(parsedAction, snapshotElements));
  candidates.push(...buildNearbyLabeledControlCandidates(parsedAction, snapshotElements));

  for (const element of snapshotElements) {
    const match = matchElement(parsedAction, element);
    if (!match.matches) {
      continue;
    }

    const structuredLocators = element.structuredLocatorPriority?.length
      ? element.structuredLocatorPriority
      : buildStructuredLocatorPriority(element);
    const allowedLocators = filterLocatorsForAction(parsedAction, element, structuredLocators);

    allowedLocators.forEach((structuredLocator, index) => {
      const locator = locatorToString(structuredLocator);
      candidates.push({
        locator,
        locatorType: structuredLocator.method,
        priority: match.score + locatorPreference(parsedAction, structuredLocator, element) + index,
        source: `deterministic:${match.matchFields.join(',')}`,
        ...scoreCandidateConfidence(structuredLocator, element),
        elementSummary: summarizeElement(element),
        structuredLocator
      });
    });
  }

  return dedupeCandidates(candidates).sort((left, right) => left.priority - right.priority);
}

function buildNearbyLabeledControlCandidates(
  parsedAction: ParsedAction,
  snapshotElements: DomElementSnapshot[]
): LocatorCandidate[] {
  if (!parsedAction.target || parsedAction.actionType !== 'select') {
    return [];
  }

  if (!getLocatorPolicy().ALLOW_XPATH_LOCATORS) {
    return [];
  }

  const target = normalize(parsedAction.target);
  if (!target) {
    return [];
  }

  const labels = snapshotElements.filter((element) => {
    if (element.tag.toLowerCase() !== 'label' || !element.boundingBox) {
      return false;
    }

    const labelText = normalize(element.text ?? element.label ?? '');
    return labelText === target || labelText.includes(target);
  });

  const candidates: LocatorCandidate[] = [];
  for (const label of labels) {
    const control = findControlNearLabel(parsedAction, label, snapshotElements);
    if (!control) {
      continue;
    }

    const structuredLocator: StructuredLocator = {
      method: 'fieldControlByLabel',
      label: label.text ?? label.label ?? parsedAction.target,
      controlSelector:
        parsedAction.actionType === 'select'
          ? 'select, [role="combobox"], [aria-haspopup], [aria-expanded]'
          : 'input, textarea, [contenteditable="true"], [role="textbox"]'
    };

    candidates.push({
      locator: locatorToString(structuredLocator),
      locatorType: structuredLocator.method,
      priority: 1 + elementKindWeight(parsedAction, control),
      source: 'deterministic:nearby-label-control',
      selectorConfidenceScore: 0.86,
      selectorRisk: 'low',
      selectorConfidenceSignals: ['nearbyLabelScopedControl', 'payloadTarget'],
      elementSummary: {
        label: summarizeElement(label),
        control: summarizeElement(control)
      },
      structuredLocator
    });
  }

  return candidates;
}

function buildExactTargetCandidates(parsedAction: ParsedAction): LocatorCandidate[] {
  const target = parsedAction.target?.trim();
  if (!target || target === '__FORM__') {
    return [];
  }

  const candidates: LocatorCandidate[] = [];
  const targetTexts = targetVariants(target);

  const push = (structuredLocator: StructuredLocator, priority: number, source = 'deterministic:atomic-exact-target') => {
    candidates.push({
      locator: locatorToString(structuredLocator),
      locatorType: structuredLocator.method,
      priority,
      source,
      selectorConfidenceScore: 0.92,
      selectorRisk: 'low',
      selectorConfidenceSignals: ['atomicActionTarget', 'exactNameFirst'],
      elementSummary: { atomicTarget: target },
      structuredLocator
    });
  };

  if (parsedAction.actionType === 'navigate' || parsedAction.actionType === 'click') {
    for (const targetText of targetTexts) {
      push({ method: 'getByRole', role: 'button', name: targetText, exact: true }, 0);
      push({ method: 'getByRole', role: 'link', name: targetText, exact: true }, 1);
      push({ method: 'getByRole', role: 'menuitem', name: targetText, exact: true }, 2);
      push({ method: 'getByText', text: targetText, exact: true }, 5);
      push({ method: 'getByRole', role: 'button', name: targetText, exact: false }, 20, 'deterministic:atomic-fuzzy-target');
      push({ method: 'getByRole', role: 'link', name: targetText, exact: false }, 21, 'deterministic:atomic-fuzzy-target');
      push({ method: 'getByRole', role: 'menuitem', name: targetText, exact: false }, 22, 'deterministic:atomic-fuzzy-target');
      push({ method: 'getByText', text: targetText, exact: false }, 30, 'deterministic:atomic-fuzzy-target');
    }
  }

  if (parsedAction.actionType === 'fill') {
    push({ method: 'getByLabel', text: target, exact: true }, 0);
    push({ method: 'getByPlaceholder', text: target, exact: true }, 1);
    push({ method: 'getByRole', role: 'textbox', name: target, exact: true }, 2);
    push({ method: 'getByLabel', text: target, exact: false }, 20, 'deterministic:atomic-fuzzy-target');
    push({ method: 'getByPlaceholder', text: target, exact: false }, 21, 'deterministic:atomic-fuzzy-target');
    push({ method: 'getByRole', role: 'textbox', name: target, exact: false }, 22, 'deterministic:atomic-fuzzy-target');
  }

  if (parsedAction.actionType === 'select') {
    push({ method: 'getByRole', role: 'combobox', name: target, exact: true }, 0);
    push({ method: 'getByLabel', text: target, exact: true }, 1);
    push({ method: 'getByText', text: `Select ${target}`, exact: true }, 2);
    push({ method: 'getByRole', role: 'button', name: `Select ${target}`, exact: true }, 3);
    push({ method: 'getByRole', role: 'combobox', name: target, exact: false }, 20, 'deterministic:atomic-fuzzy-target');
    push({ method: 'getByLabel', text: target, exact: false }, 21, 'deterministic:atomic-fuzzy-target');
  }

  return candidates;
}

function findControlNearLabel(
  parsedAction: ParsedAction,
  label: DomElementSnapshot,
  snapshotElements: DomElementSnapshot[]
): DomElementSnapshot | null {
  const labelBox = label.boundingBox;
  if (!labelBox) {
    return null;
  }

  const nearbyControls = snapshotElements
    .filter((element) => element.index !== label.index && element.boundingBox && isElementCompatible(parsedAction, element))
    .map((element) => ({
      element,
      distance: labeledControlDistance(labelBox, element.boundingBox!)
    }))
    .filter(({ distance }) => distance < Number.MAX_SAFE_INTEGER)
    .sort((left, right) => left.distance - right.distance);

  return nearbyControls[0]?.element ?? null;
}

function labeledControlDistance(labelBox: { x: number; y: number; width: number; height: number }, controlBox: { x: number; y: number; width: number; height: number }): number {
  const verticalGap = controlBox.y - (labelBox.y + labelBox.height);
  const overlapsHorizontally = controlBox.x < labelBox.x + labelBox.width + 24 && controlBox.x + controlBox.width > labelBox.x - 24;
  const belowOrAligned = verticalGap >= -8 && verticalGap <= 90;

  if (!overlapsHorizontally || !belowOrAligned) {
    return Number.MAX_SAFE_INTEGER;
  }

  return Math.abs(verticalGap) + Math.abs(controlBox.x - labelBox.x) / 10;
}

function buildRowActionMenuCandidates(
  parsedAction: ParsedAction,
  snapshotElements: DomElementSnapshot[]
): LocatorCandidate[] {
  if (!['click', 'row_action'].includes(parsedAction.actionType) || !parsedAction.target) {
    return [];
  }

  const rowTargetMatch = parsedAction.target.match(/^actions?\s+menu\s+for\s+(.+)$/i);
  const rowTarget = parsedAction.payloadIdentity?.identityValue ?? rowTargetMatch?.[1]?.trim();
  if (!rowTarget) {
    return [];
  }

  const rowElement = snapshotElements.find((element) => {
    const tag = element.tag.toLowerCase();
    const role = element.role?.toLowerCase();
    const text = element.text ?? '';
    return (tag === 'tr' || role === 'row') && normalize(text).includes(normalize(rowTarget));
  });

  if (!rowElement) {
    return [];
  }

  const structuredLocator: StructuredLocator = {
    method: 'rowButtonByText',
    text: rowTarget,
    buttonIndex: 0
  };

  return [
    {
      locator: locatorToString(structuredLocator),
      locatorType: structuredLocator.method,
      priority: 0,
      source: 'deterministic:row-action-menu',
      selectorConfidenceScore: 0.9,
      selectorRisk: 'low',
      selectorConfidenceSignals: ['rowScopedButton', 'payloadTarget'],
      elementSummary: summarizeElement(rowElement),
      structuredLocator
    }
  ];
}

function matchElement(
  parsedAction: ParsedAction,
  element: DomElementSnapshot
): { matches: boolean; score: number; matchFields: string[]; matchedTarget: string } {
  const target = parsedAction.target ?? '';
  const targets = targetVariants(target);
  const fields = searchableFields(element);
  const matchFields: string[] = [];
  let bestScore = Number.MAX_SAFE_INTEGER;
  let matchedTarget = target;

  for (const [field, value] of Object.entries(fields)) {
    if (!value) {
      continue;
    }

    const normalizedValue = normalize(value);
    if (!normalizedValue) {
      continue;
    }

    for (const targetVariant of targets) {
      const normalizedTarget = normalize(targetVariant);
      const exact = normalizedValue === normalizedTarget;
      const contains = normalizedValue.includes(normalizedTarget);
      const wordMatch = targetWords(targetVariant).every((word) => normalizedValue.includes(word));
      const semanticScore = semanticSimilarityScore(targetVariant, value);
      const semanticMatch = semanticScore >= 0.72;

      if (exact || contains || wordMatch || semanticMatch) {
        matchFields.push(!exact && !contains && (wordMatch || semanticMatch) ? `${field}:semantic` : field);
        matchedTarget = targetVariant;
        const fieldScore = exact ? 0 : contains ? 10 : wordMatch ? 20 : Math.round(35 - semanticScore * 20);
        bestScore = Math.min(bestScore, fieldScore + fieldWeight(field));
      }
    }
  }

  if (matchFields.length === 0) {
    return { matches: false, score: 0, matchFields: [], matchedTarget };
  }

  return {
    matches: isElementCompatible(parsedAction, element),
    score: bestScore + elementKindWeight(parsedAction, element),
    matchFields,
    matchedTarget
  };
}

function searchableFields(element: DomElementSnapshot): Record<string, string | undefined> {
  return {
    testId: element.dataTestId || element.dataTest || element.dataCy || element.dataQa,
    label: element.label,
    placeholder: element.placeholder,
    ariaLabel: element.ariaLabel,
    text: element.text,
    name: element.name,
    id: element.id,
    role: element.role,
    title: element.title
  };
}

function isElementCompatible(parsedAction: ParsedAction, element: DomElementSnapshot): boolean {
  const tag = element.tag.toLowerCase();
  const role = element.role?.toLowerCase();
  const type = element.type?.toLowerCase();

  if (parsedAction.actionType === 'fill') {
    return (
      ['input', 'textarea'].includes(tag) ||
      element.role === 'textbox' ||
      Boolean(element.className?.includes('contenteditable')) ||
      type === 'email' ||
      type === 'text'
    );
  }

  if (parsedAction.actionType === 'select') {
    return (
      ['select', 'option'].includes(tag) ||
      ['combobox', 'listbox'].includes(role ?? '') ||
      (role === 'button' && hasSelectCue(parsedAction, element)) ||
      (['div', 'span'].includes(tag) && element.isLikelyClickable === true && hasSelectCue(parsedAction, element))
    );
  }

  if (parsedAction.actionType === 'click' || parsedAction.actionType === 'navigate' || parsedAction.actionType === 'row_action') {
    return (
      ['button', 'a', 'li'].includes(tag) ||
      ['button', 'link', 'menuitem', 'tab', 'option'].includes(role ?? '') ||
      type === 'button' ||
      type === 'submit' ||
      (['div', 'span'].includes(tag) && element.isLikelyClickable === true)
    );
  }

  return false;
}

function hasSelectCue(parsedAction: ParsedAction, element: DomElementSnapshot): boolean {
  const target = normalize(parsedAction.target ?? '');
  if (!target) {
    return false;
  }

  const values = Object.values(searchableFields(element)).filter((value): value is string => Boolean(value));
  return values.some((value) => {
    const normalizedValue = normalize(value);
    return normalizedValue.includes(target) && /select|choose|dropdown/i.test(value);
  });
}

function filterLocatorsForAction(
  parsedAction: ParsedAction,
  element: DomElementSnapshot,
  locators: StructuredLocator[]
): StructuredLocator[] {
  if (parsedAction.actionType === 'fill') {
    const preferred = locators.filter((locator) =>
      ['getByLabel', 'getByPlaceholder', 'getByTestId', 'css', 'getByRole'].includes(locator.method)
    );
    return preferred.length ? preferred : locators;
  }

  if (parsedAction.actionType === 'select') {
    const preferred = locators.filter((locator) => {
      if (locator.method === 'getByRole') {
        return ['combobox', 'button', 'listbox', 'option'].includes(locator.role);
      }
      return ['getByLabel', 'getByText', 'getByTestId', 'css', 'xpath'].includes(locator.method);
    });
    return preferred.length ? preferred : locators;
  }

  if (parsedAction.actionType === 'click' || parsedAction.actionType === 'navigate' || parsedAction.actionType === 'row_action') {
    const semanticTextLocator = semanticClickTextLocator(parsedAction, element);
    const preferred = locators.filter((locator) => {
      if (locator.method === 'getByRole') {
        return ['button', 'link', 'menuitem', 'tab', 'option'].includes(locator.role);
      }
      return ['getByText', 'getByTestId', 'css', 'xpath'].includes(locator.method);
    });

    if (preferred.length) {
      return semanticTextLocator ? [semanticTextLocator, ...preferred] : preferred;
    }

    return semanticTextLocator ? [semanticTextLocator, ...locators] : locators;
  }

  return locators.filter((locator) => !(parsedAction.actionType === 'fill' && locator.method === 'getByText'));
}

function semanticClickTextLocator(parsedAction: ParsedAction, element: DomElementSnapshot): StructuredLocator | null {
  const text = element.text;
  if (!text) {
    return null;
  }

  const matchedTarget = targetVariants(parsedAction.target ?? '').find((target) => {
    const normalizedTarget = normalize(target);
    return normalizedTarget.length > 0 && normalize(text).includes(normalizedTarget);
  });

  if (!matchedTarget) {
    return null;
  }

  const role = element.role?.toLowerCase();
  if (role && ['dialog', 'table', 'row', 'rowgroup', 'cell', 'columnheader'].includes(role)) {
    return null;
  }

  if (element.tag.toLowerCase() === 'div' && element.isLikelyClickable !== true && text.length > 80) {
    return null;
  }

  return {
    method: 'getByText',
    text: matchedTarget,
    exact: false
  };
}

function locatorPreference(parsedAction: ParsedAction, locator: StructuredLocator, element: DomElementSnapshot): number {
  const base = actionLocatorPreference[locator.method] ?? 20;
  const role = element.role?.toLowerCase();

  if ((parsedAction.actionType === 'click' || parsedAction.actionType === 'navigate' || parsedAction.actionType === 'row_action') && locator.method === 'getByRole') {
    if (['button', 'link', 'menuitem'].includes(role ?? '')) {
      return base - 1;
    }
  }

  if (parsedAction.actionType === 'fill' && ['getByLabel', 'getByPlaceholder'].includes(locator.method)) {
    return base - 2;
  }

  if (parsedAction.actionType === 'select' && locator.method === 'getByRole' && ['combobox', 'button'].includes(role ?? '')) {
    return base - 2;
  }

  return base;
}

function elementKindWeight(parsedAction: ParsedAction, element: DomElementSnapshot): number {
  const tag = element.tag.toLowerCase();
  const role = element.role?.toLowerCase();

  if ((parsedAction.actionType === 'click' || parsedAction.actionType === 'navigate' || parsedAction.actionType === 'row_action') && ['button', 'a'].includes(tag)) return 0;
  if ((parsedAction.actionType === 'click' || parsedAction.actionType === 'navigate' || parsedAction.actionType === 'row_action') && ['button', 'link', 'menuitem'].includes(role ?? '')) return 2;
  if (parsedAction.actionType === 'fill' && ['input', 'textarea'].includes(tag)) return 0;
  if (parsedAction.actionType === 'select' && tag === 'select') return 0;
  if (parsedAction.actionType === 'select' && ['combobox', 'button'].includes(role ?? '')) return 2;
  return 8;
}

function fieldWeight(field: string): number {
  switch (field) {
    case 'testId':
      return 0;
    case 'label':
    case 'ariaLabel':
      return 1;
    case 'placeholder':
      return 2;
    case 'text':
      return 3;
    case 'name':
      return 4;
    case 'id':
      return 6;
    default:
      return 8;
  }
}

function summarizeElement(element: DomElementSnapshot): Record<string, unknown> {
  return {
    index: element.index,
    tag: element.tag,
    type: element.type,
    role: element.role,
    text: element.text,
    label: element.label,
    ariaLabel: element.ariaLabel,
    placeholder: element.placeholder,
    name: element.name,
    id: element.id,
    testId: element.dataTestId || element.dataTest || element.dataCy || element.dataQa,
    isLikelyClickable: element.isLikelyClickable
  };
}

function dedupeCandidates(candidates: LocatorCandidate[]): LocatorCandidate[] {
  const byLocator = new Map<string, LocatorCandidate>();

  for (const candidate of candidates) {
    const existing = byLocator.get(candidate.locator);
    if (!existing || candidate.priority < existing.priority) {
      byLocator.set(candidate.locator, candidate);
    }
  }

  return [...byLocator.values()];
}

function scoreCandidateConfidence(
  locator: StructuredLocator,
  element: DomElementSnapshot
): Pick<LocatorCandidate, 'selectorConfidenceScore' | 'selectorRisk' | 'selectorConfidenceSignals'> {
  let score = element.selectorConfidenceScore ?? 0.5;
  const signals = new Set<string>(element.selectorConfidenceSignals ?? []);

  if (locator.method === 'getByTestId') {
    score += 0.15;
    signals.add('testIdLocator');
  } else if (locator.method === 'getByRole') {
    score += 0.08;
    signals.add('roleLocator');
  } else if (locator.method === 'xpath') {
    score -= 0.15;
    signals.add('xpathPenalty');
  }

  if (locator.method === 'css' && locator.selector.includes(':nth-')) {
    score -= 0.2;
    signals.add('nthChildPenalty');
  }

  const normalized = Math.max(0, Math.min(1, Number(score.toFixed(2))));
  const selectorRisk: 'low' | 'medium' | 'high' =
    normalized >= 0.8 ? 'low' : normalized >= 0.55 ? 'medium' : 'high';

  return {
    selectorConfidenceScore: normalized,
    selectorRisk,
    selectorConfidenceSignals: [...signals]
  };
}

function targetWords(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 1 && !semanticStopWords.has(word));
}

const semanticStopWords = new Set([
  'a',
  'an',
  'and',
  'by',
  'field',
  'id',
  'in',
  'into',
  'of',
  'on',
  'or',
  'the',
  'to'
]);

function semanticSimilarityScore(target: string, value: string): number {
  const targetTokens = targetWords(target);
  const valueTokens = targetWords(value);

  if (targetTokens.length === 0 || valueTokens.length === 0) {
    return 0;
  }

  const targetSet = new Set(targetTokens);
  const valueSet = new Set(valueTokens);
  const shared = [...targetSet].filter((word) => valueSet.has(word)).length;
  const precision = shared / valueSet.size;
  const recall = shared / targetSet.size;

  if (shared === 0) {
    return 0;
  }

  return (2 * precision * recall) / (precision + recall);
}

function targetVariants(value: string): string[] {
  const variants = new Set<string>();
  const cleanValue = value
    .replace(/\bclick\s+on\b/gi, '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleanValue) {
    variants.add(cleanValue);
  }

  if (/\bactions?\s+menu\b|\bmenu\b/i.test(cleanValue)) {
    variants.add('Actions menu');
    variants.add('Row actions');
    variants.add('Options menu');
    variants.add('Context menu');
    variants.add('More actions');
    variants.add('More');
  }

  if (/\bnew\b/i.test(cleanValue)) {
    variants.add(cleanValue.replace(/\bnew\b/gi, 'Add'));
  }

  if (/\badd\b/i.test(cleanValue)) {
    variants.add(cleanValue.replace(/\badd\b/gi, 'New'));
  }

  if (/email|address|name|user|id/i.test(cleanValue)) {
    variants.add('Search');
    variants.add('Search by name or email');
    variants.add('Search by name');
    variants.add('Search by email');
    variants.add('Search...');
  }

  return [...variants];
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
