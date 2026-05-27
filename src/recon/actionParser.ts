import type { ScenarioStep } from '../types';
import type { ActionType, ParsedAction } from './reconDecisionTypes';

const secretKeyPattern = /(password|passcode|secret|token|jwt|cookie|authorization|api[_-]?key)/i;

export function parseAction(step: string | ScenarioStep, payload: Record<string, unknown> = {}): ParsedAction {
  const rawStep = normalizeRawStep(typeof step === 'string' ? step : step.instruction);
  const stepNo = typeof step === 'string' ? undefined : step.step_no;
  const normalized = rawStep.toLowerCase();
  const actionType = detectActionType(normalized);
  const target = extractTarget(rawStep, actionType, payload);
  const value = valueForAction(actionType, target, payload);

  return {
    rawStep,
    stepNo,
    actionType,
    target,
    value
  };
}

export function sanitizePayload(payload: Record<string, unknown>): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (secretKeyPattern.test(key) || value === undefined || value === null) {
      continue;
    }

    const stringValue = String(value);
    if (secretKeyPattern.test(stringValue)) {
      continue;
    }

    sanitized[key] = stringValue;
  }

  return sanitized;
}

function detectActionType(normalizedStep: string): ActionType {
  if (/^(navigate|go)\s+to\b/.test(normalizedStep) || /^navigate\b/.test(normalizedStep)) return 'navigate';
  if (/^click\b/.test(normalizedStep)) return 'click';
  if (/^(enter|fill|type)\b/.test(normalizedStep)) return 'fill';
  if (/^(select|choose)\b/.test(normalizedStep)) return 'select';
  if (/^(verify|check|assert)\b/.test(normalizedStep)) return 'verify';
  if (/^wait\b/.test(normalizedStep)) return 'wait';
  return 'unknown';
}

function extractTarget(rawStep: string, actionType: ActionType, payload: Record<string, unknown>): string | null {
  const payloadKeys = Object.keys(sanitizePayload(payload));
  const lowerStep = rawStep.toLowerCase();

  if (actionType === 'fill' && /\b(user details|details|all fields|form|payload)\b/i.test(rawStep)) {
    return '__FORM__';
  }

  if (actionType === 'select') {
    const payloadKeyMatch = findPayloadKeyMention(rawStep, payloadKeys);
    if (payloadKeyMatch) {
      return payloadKeyMatch;
    }

    if (/\brole\b/i.test(rawStep)) return 'Role';
    if (/\bstatus\b/i.test(rawStep)) return 'Status';

    const selectMatch = rawStep.match(/\b(?:select|choose|open)\s+(?:the\s+)?(.+?)(?:\s+dropdown)?(?:\s+and\s+.*)?$/i);
    return cleanTarget(selectMatch?.[1] ?? rawStep);
  }

  if (actionType === 'navigate') {
    return cleanTarget(rawStep.match(/^(?:navigate|go)\s+(?:to\s+)?(.+)$/i)?.[1] ?? rawStep);
  }

  if (actionType === 'click') {
    return cleanTarget(rawStep.match(/^click\s+(?:on\s+)?(.+)$/i)?.[1] ?? rawStep);
  }

  if (actionType === 'fill') {
    const payloadKeyMatch = findPayloadKeyMention(rawStep, payloadKeys);
    if (payloadKeyMatch) {
      return payloadKeyMatch;
    }

    const fillMatch = rawStep.match(/^(?:fill|enter|type)\s+(.+)$/i);
    return cleanTarget(fillMatch?.[1] ?? rawStep);
  }

  if (actionType === 'verify') {
    return cleanTarget(rawStep.replace(/\b(verify|check|assert)\b/gi, ''));
  }

  if (actionType === 'wait') {
    return lowerStep.includes('network') ? 'networkidle' : null;
  }

  return null;
}

function valueForAction(actionType: ActionType, target: string | null, payload: Record<string, unknown>): string | null {
  if ((actionType !== 'fill' && actionType !== 'select') || !target || target === '__FORM__') {
    return null;
  }

  const sanitizedPayload = sanitizePayload(payload);
  const exactEntry = Object.entries(sanitizedPayload).find(([key]) => normalize(key) === normalize(target));
  if (exactEntry) {
    return exactEntry[1];
  }

  const containsEntry = Object.entries(sanitizedPayload).find(([key]) => normalize(target).includes(normalize(key)));
  return containsEntry?.[1] ?? null;
}

function findPayloadKeyMention(rawStep: string, payloadKeys: string[]): string | null {
  const normalizedStep = normalize(rawStep);
  const sortedKeys = [...payloadKeys].sort((a, b) => b.length - a.length);
  return sortedKeys.find((key) => normalizedStep.includes(normalize(key))) ?? null;
}

function cleanTarget(value: string): string | null {
  const cleaned = value
    .replace(/\.$/, '')
    .replace(/\b(page|screen|menu|section|button|link|field|dropdown|option)\b/gi, '')
    .replace(/\b(and select|and choose).+$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || null;
}

function normalizeRawStep(value: string): string {
  return value
    .trim()
    .replace(/^(?:step\s*)?\d+[\).:-]\s*/i, '')
    .split(/\s*;\s*/)[0]
    .replace(/\bclick\s+on\b/gi, 'Click')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
