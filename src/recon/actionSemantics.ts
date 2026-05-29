import type { ReconAction } from './reconActionExtractor';
import { sanitizePayload } from './actionParser';

export function isKnownDropdownField(target: string | null, payload: Record<string, unknown> = {}): boolean {
  if (!target) {
    return false;
  }

  const sanitized = sanitizePayload(payload);
  if (Object.prototype.hasOwnProperty.call(sanitized, target)) {
    return true;
  }

  const normalizedTarget = normalizeKey(target);
  return Object.keys(sanitized).some((key) => normalizeKey(key) === normalizedTarget);
}

export function shouldReclassifySelectAsClick(
  target: string | null,
  value: string | null,
  payload: Record<string, unknown> = {}
): boolean {
  if (value?.trim()) {
    return false;
  }

  return !isKnownDropdownField(target, payload);
}

export function isSearchStep(rawStep: string): boolean {
  return /\bsearch\b/i.test(rawStep) && /\b(?:user|name|email|find|filter)\b/i.test(rawStep);
}

export function resolvePayloadKeyForStep(
  rawStep: string,
  target: string | null,
  payload: Record<string, unknown> = {}
): string | null {
  const sanitized = sanitizePayload(payload);
  const keys = Object.keys(sanitized);

  if (target && Object.prototype.hasOwnProperty.call(sanitized, target)) {
    return target;
  }

  const normalizedStep = normalizeKey(rawStep);
  const sortedKeys = [...keys].sort((left, right) => right.length - left.length);
  for (const key of sortedKeys) {
    if (normalizedStep.includes(normalizeKey(key))) {
      return key;
    }
  }

  if (isSearchStep(rawStep)) {
    const emailKey = keys.find((key) => /@/.test(sanitized[key]));
    if (emailKey) {
      return emailKey;
    }

    const nameKey = keys.find((key) => /\s/.test(sanitized[key]) && sanitized[key].trim().length > 2);
    if (nameKey) {
      return nameKey;
    }

    return keys[0] ?? null;
  }

  return null;
}

export function resolveComposedNamePayloadKeys(payload: Record<string, unknown>): [string, string] | null {
  const sanitized = sanitizePayload(payload);
  const keys = Object.keys(sanitized);
  const firstKey = keys.find((key) => /first/i.test(key) && /name/i.test(key));
  const lastKey = keys.find((key) => /last/i.test(key) && /name/i.test(key));

  if (firstKey && lastKey) {
    return [firstKey, lastKey];
  }

  return null;
}

export function searchPayloadExpression(
  payload: Record<string, unknown>,
  rawStep: string,
  target: string | null = null
): string {
  const composed = resolveComposedNamePayloadKeys(payload);
  if (isSearchStep(rawStep) && composed && !resolvePayloadKeyForStep(rawStep, target, payload)) {
    const [firstKey, lastKey] = composed;
    return `\`\${payload[${JSON.stringify(firstKey)}]} \${payload[${JSON.stringify(lastKey)}]}\`.trim()`;
  }

  const key = resolvePayloadKeyForStep(rawStep, target, payload);
  if (!key) {
    return '""';
  }

  return `String(payload[${JSON.stringify(key)}])`;
}

export function isDropdownSelectAction(action: ReconAction, payload: Record<string, unknown>): boolean {
  if (!isKnownDropdownField(action.target, payload)) {
    const optionValue = String(action.selectedValue ?? action.value ?? action.optionValue ?? '').trim();
    if (!optionValue) {
      return false;
    }
  }

  const expr = payloadValueExpressionForAction(action, payload);
  return expr !== '""';
}

export function payloadValueExpressionForAction(action: ReconAction, payload: Record<string, unknown>): string {
  const target = action.target;
  if (target && Object.prototype.hasOwnProperty.call(payload, target)) {
    return `String(payload[${JSON.stringify(target)}])`;
  }

  const key = resolvePayloadKeyForStep(action.rawStep, target, payload);
  if (key) {
    return `String(payload[${JSON.stringify(key)}])`;
  }

  const matchingKey = Object.keys(payload).find(
    (entry) => String(payload[entry]) === String(action.selectedValue ?? action.value ?? '')
  );
  if (matchingKey) {
    return `String(payload[${JSON.stringify(matchingKey)}])`;
  }

  return JSON.stringify(String(action.selectedValue ?? action.value ?? action.optionValue ?? ''));
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
