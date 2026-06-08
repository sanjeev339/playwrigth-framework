import type { ScenarioStep } from '../types';
import type { ActionType, ParsedAction } from './reconDecisionTypes';
import { resolvePayloadIdentity } from '../scenario/payloadIdentityResolver';

const secretKeyPattern = /(password|passcode|secret|token|jwt|cookie|authorization|api[_-]?key)/i;

export function isSecretPayloadKey(key: string | null | undefined): boolean {
  return Boolean(key && secretKeyPattern.test(key));
}

export function parseAction(step: string | ScenarioStep, payload: Record<string, unknown> = {}): ParsedAction {
  const atomicAction = typeof step === 'string' ? null : getAtomicAction(step);
  if (atomicAction && typeof step !== 'string') {
    const rawStep = normalizeRawStep(step.instruction || normalizeNullableString(atomicAction.rawActionText) || '');
    const actionType = normalizeAtomicActionType(atomicAction.actionType);
    const target = normalizeNullableString(atomicAction.target);
    const payloadKey = normalizeNullableString(atomicAction.payloadKey) ?? (target ? findPayloadKeyMention(target, Object.keys(payload)) : null);
    const value = normalizeNullableString(atomicAction.value) ?? valueForAction(actionType, target, payload);
    const payloadIdentity = actionType === 'row_action' ? resolveRowActionIdentity(rawStep, payload) : null;

    return {
      rawStep,
      stepNo: step.step_no,
      actionType,
      target,
      value,
      payloadKey,
      isSensitiveValue: isSecretPayloadKey(payloadKey),
      payloadIdentity,
      rowAction: actionType === 'row_action' ? extractRowAction(rawStep) : null
    };
  }

  const rawStep = normalizeRawStep(typeof step === 'string' ? step : step.instruction);
  const stepNo = typeof step === 'string' ? undefined : step.step_no;
  const normalized = rawStep.toLowerCase();
  const actionType = detectActionType(normalized);
  const target = extractTarget(rawStep, actionType, payload);
  const value = valueForAction(actionType, target, payload);
  const payloadKey = ['fill', 'select', 'navigate'].includes(actionType) && target
    ? findPayloadKeyMention(target, Object.keys(payload))
    : null;
  const payloadIdentity = actionType === 'row_action' ? resolveRowActionIdentity(rawStep, payload) : null;

  return {
    rawStep,
    stepNo,
    actionType,
    target,
    value,
    payloadKey,
    isSensitiveValue: isSecretPayloadKey(payloadKey),
    payloadIdentity,
    rowAction: actionType === 'row_action' ? extractRowAction(rawStep) : null
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
  if (isRowActionStep(normalizedStep)) return 'row_action';
  if (/^(navigate|go)\s+to\b/.test(normalizedStep) || /^navigate\b/.test(normalizedStep)) return 'navigate';
  if (/^click\b/.test(normalizedStep)) return 'click';
  if (/^(enter|fill|type)\b/.test(normalizedStep)) return 'fill';
  if (/^(select|choose)\b/.test(normalizedStep)) return 'select';
  if (/^(verify|check|assert)\b/.test(normalizedStep)) return 'verify';
  if (/^wait\b/.test(normalizedStep)) return 'wait';
  return 'unknown';
}

function isRowActionStep(normalizedStep: string): boolean {
  if (/^click\s+(?:the\s+)?actions?\s+menu\s+for\b/.test(normalizedStep)) {
    return true;
  }

  const hasRowSubject = /\b(record|row|table|list|item|customer|user|license|employee|member|account|entry|profile)\b/.test(normalizedStep);
  const hasActionMenu = /\b(menu|actions?|more)\b/.test(normalizedStep);
  const hasRowAction = /\b(edit|delete|remove|view|open|details|disable|enable|activate|deactivate|approve|reject)\b/.test(normalizedStep);
  return hasRowSubject && hasActionMenu && hasRowAction;
}

function extractTarget(rawStep: string, actionType: ActionType, payload: Record<string, unknown>): string | null {
  const payloadKeys = Object.keys(payload);
  const lowerStep = rawStep.toLowerCase();

  if (actionType === 'fill' && /\b(user details|details|required fields|all fields|form|payload)\b/i.test(rawStep)) {
    return '__FORM__';
  }

  if (actionType === 'row_action') {
    const menuMatch = rawStep.match(/^click\s+(?:the\s+)?actions?\s+menu\s+for\s+(.+)$/i);
    if (menuMatch?.[1]) {
      return `Actions Menu for ${menuMatch[1].trim()}`;
    }

    return 'Actions Menu';
  }

  if (actionType === 'select') {
    const payloadKeyMatch = findPayloadKeyMention(rawStep, payloadKeys);
    if (payloadKeyMatch) {
      return payloadKeyMatch;
    }

    const selectMatch = rawStep.match(/\b(?:select|choose|open)\s+(?:the\s+)?(.+?)(?:\s+dropdown)?(?:\s+and\s+.*)?$/i);
    return cleanTarget(selectMatch?.[1] ?? rawStep);
  }

  if (actionType === 'navigate') {
    return cleanTarget(rawStep.match(/^(?:navigate|go)\s+(?:to\s+)?(.+)$/i)?.[1] ?? rawStep);
  }

  if (actionType === 'click') {
    return cleanClickTarget(rawStep.match(/^click\s+(?:on\s+)?(.+)$/i)?.[1] ?? rawStep);
  }

  if (actionType === 'fill') {
    if (/^enter\s+search\s+by\s+name\s+or\s+email$/i.test(rawStep)) {
      return 'Search by name or email';
    }

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
  if (!['fill', 'select', 'navigate'].includes(actionType) || !target || target === '__FORM__') {
    return null;
  }

  const exactEntry = Object.entries(payload).find(
    ([key, value]) => value !== undefined && value !== null && normalize(key) === normalize(target)
  );
  if (exactEntry) {
    return String(exactEntry[1]);
  }

  const containsEntry = Object.entries(payload).find(([key, value]) => {
    if (value === undefined || value === null) {
      return false;
    }
    const normalizedKey = normalize(key);
    const normalizedTarget = normalize(target);
    return normalizedTarget.includes(normalizedKey) || normalizedKey.includes(normalizedTarget);
  });
  if (containsEntry) {
    return String(containsEntry[1]);
  }

  if (/search\s*by\s*name\s*or\s*email/i.test(target)) {
    const searchEntry = ['Email Address', 'Full Name', 'First Name'].find((key) => payload[key] !== undefined && payload[key] !== null);
    return searchEntry ? String(payload[searchEntry]) : null;
  }

  return null;
}

function findPayloadKeyMention(rawStep: string, payloadKeys: string[]): string | null {
  const normalizedStep = normalize(rawStep);
  const sortedKeys = [...payloadKeys].sort((a, b) => b.length - a.length);
  return sortedKeys.find((key) => normalizedStep.includes(normalize(key))) ?? null;
}

function cleanTarget(value: string): string | null {
  let cleaned = value
    .replace(/\.$/, '')
    .replace(/\b(page|screen|menu|section|button|link|field|dropdown|option)\b/gi, '')
    .replace(/\b(and select|and choose).+$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.toLowerCase().startsWith('to ')) {
    cleaned = cleaned.substring(3).trim();
  }

  return cleaned || null;
}

function cleanClickTarget(value: string): string | null {
  const normalized = value.replace(/\.$/, '').replace(/\s+/g, ' ').trim();
  const rowActionMenuMatch = normalized.match(/^(?:the\s+)?(?:actions?\s+)?menu\s+for\s+(.+)$/i);
  if (rowActionMenuMatch?.[1]) {
    return `Actions Menu for ${rowActionMenuMatch[1].trim()}`;
  }

  if (/^(?:the\s+)?(?:actions?\s+)?menu$/i.test(normalized) || /\bactions?\s+menu\b/i.test(normalized)) {
    return 'Actions Menu';
  }

  return cleanTarget(normalized);
}

function resolveRowActionIdentity(rawStep: string, payload: Record<string, unknown>) {
  const menuMatch = rawStep.match(/^click\s+(?:the\s+)?actions?\s+menu\s+for\s+(.+)$/i);
  if (menuMatch?.[1]) {
    const identityValue = menuMatch[1].trim();
    const payloadIdentity = resolvePayloadIdentity(payload);
    return {
      identityKey: payloadIdentity?.identityValue === identityValue ? payloadIdentity.identityKey : 'instruction',
      identityValue
    };
  }

  return resolvePayloadIdentity(payload);
}

function extractRowAction(rawStep: string): string | null {
  const explicitAction = rawStep.match(/\b(?:select|choose|click)\s+(?:on\s+)?(?:the\s+)?(edit|delete|remove|view|open|details|disable|enable|activate|deactivate|approve|reject)\b/i);
  if (explicitAction?.[1]) {
    return explicitAction[1].charAt(0).toUpperCase() + explicitAction[1].slice(1).toLowerCase();
  }

  return null;
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

function getAtomicAction(step: ScenarioStep): {
  actionType?: unknown;
  target?: unknown;
  value?: unknown;
  payloadKey?: unknown;
  rawActionText?: unknown;
} | null {
  const candidate = (step as ScenarioStep & { atomicAction?: unknown }).atomicAction;
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  return candidate as {
    actionType?: unknown;
    target?: unknown;
    value?: unknown;
    payloadKey?: unknown;
    rawActionText?: unknown;
  };
}

function normalizeAtomicActionType(value: unknown): ActionType {
  const actionType = String(value ?? '').trim();
  return ['navigate', 'click', 'fill', 'select', 'verify', 'wait', 'row_action', 'unknown'].includes(actionType)
    ? (actionType as ActionType)
    : 'unknown';
}

function normalizeNullableString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
