import type { ScenarioStep } from '../types';
import { resolvePayloadIdentity } from './payloadIdentityResolver';

export interface NormalizedStep extends ScenarioStep {
  step_no: number;
  instruction: string;
  raw_instruction: string;
}

type NormalizerInput = Pick<ScenarioStep, 'step_no' | 'instruction' | 'expected_result'>;

const actionStartPattern = /^(navigate|go to|open|click|enter|fill|type|set|confirm|search|select|choose|verify|check|assert|wait)\b/i;

export function normalizeScenarioSteps(
  steps: NormalizerInput[],
  payload: Record<string, unknown> = {}
): NormalizedStep[] {
  const payloadLabels = Object.keys(payload).filter((key) => !isSecretKey(key));
  const normalized: NormalizedStep[] = [];

  for (const step of steps) {
    const rawInstruction = step.instruction;
    const segments = splitInstructionIntoSegments(rawInstruction);

    for (const segment of segments) {
      const atomicInstructions = splitCompoundInstruction(cleanInstruction(segment), payloadLabels, payload);

      for (const instruction of atomicInstructions) {
        if (!instruction) {
          continue;
        }

        normalized.push({
          step_no: normalized.length + 1,
          instruction,
          raw_instruction: rawInstruction,
          expected_result: step.expected_result
        });
      }
    }
  }

  return normalized;
}

function splitInstructionIntoSegments(instruction: string): string[] {
  const cleaned = instruction.replace(/\r?\n+/g, '; ');
  const semicolonSegments = cleaned
    .split(/\s*;\s*/)
    .map(stripLeadingNumbering)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (semicolonSegments.length > 1) {
    return semicolonSegments;
  }

  const markerSegments = cleaned
    .replace(/^\s*(?:step\s*)?\d+[\).:-]\s*/i, '')
    .split(/\s+(?=(?:step\s*)?\d+[\).:-]\s+)/i)
    .map(stripLeadingNumbering)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return markerSegments.length > 1 ? markerSegments : [stripLeadingNumbering(cleaned).trim()].filter(Boolean);
}

function splitCompoundInstruction(
  instruction: string,
  payloadLabels: string[],
  payload: Record<string, unknown>
): string[] {
  const normalizedInstruction = cleanInstruction(instruction);

  if (isInviteEmailPrecondition(normalizedInstruction)) {
    return [];
  }

  if (isRegistrationLinkInstruction(normalizedInstruction) && hasPayloadKey(payload, 'Registration Link')) {
    return ['Navigate to Registration Link'];
  }

  if (isRedundantSearchOpenInstruction(normalizedInstruction) || isRedundantDropdownOpenInstruction(normalizedInstruction)) {
    return [];
  }

  const rowMenuActionSteps = splitRowMenuActionInstruction(normalizedInstruction, payload, payloadLabels);
  if (rowMenuActionSteps.length > 0) {
    return rowMenuActionSteps;
  }

  const rowSelectionStep = normalizeGenericRowSelectionInstruction(normalizedInstruction, payload);
  if (rowSelectionStep) {
    return [rowSelectionStep];
  }

  const mixedActionParts = splitMixedCompoundActions(normalizedInstruction);
  if (mixedActionParts.length > 1) {
    return mixedActionParts.map((part) => normalizeActionInstruction(part, payloadLabels, payload)).filter(Boolean);
  }

  if (/^(enter|fill|type)\b/i.test(normalizedInstruction) && /\s+and\s+/i.test(normalizedInstruction)) {
    return splitCompoundFieldInstruction(normalizedInstruction, payloadLabels);
  }

  return [normalizeActionInstruction(normalizedInstruction, payloadLabels, payload)].filter(Boolean);
}

function splitRowMenuActionInstruction(
  instruction: string,
  payload: Record<string, unknown>,
  payloadLabels: string[]
): string[] {
  // Guard: must explicitly mention a menu/actions trigger — NOT a plain "Select X" form step
  if (!/\b(menu|actions?)\b/i.test(instruction)) {
    return [];
  }

  if (!/^(click|select|choose|open)\b/i.test(instruction) || !hasGenericRowSubject(instruction)) {
    return [];
  }

  const parts = instruction.split(/\s+and\s+/i).map((part) => part.trim()).filter(Boolean);
  const finalActionPart = [...parts].reverse().find((part) => {
    if (!/^(click|select|choose)\b/i.test(part)) {
      return false;
    }

    return !/\b(menu|actions?|more)\b/i.test(part) && !isGenericRowSubject(part);
  });

  if (!finalActionPart) {
    return [];
  }

  const actionTarget = extractClickOrSelectTarget(finalActionPart);
  if (!actionTarget) {
    return [];
  }

  const rowTarget = resolvePayloadIdentity(payload)?.identityValue;
  return [
    `Click Actions Menu for ${rowTarget ?? 'record'}`,
    `Click ${canonicalizeGeneralTarget(actionTarget, payloadLabels)}`
  ];
}


function normalizeGenericRowSelectionInstruction(
  instruction: string,
  payload: Record<string, unknown>
): string | null {
  if (!/^(click|select|choose|open)\b/i.test(instruction) || !isGenericRowSelection(instruction)) {
    return null;
  }

  return `Click Actions Menu for ${resolvePayloadIdentity(payload)?.identityValue ?? 'record'}`;
}

function splitMixedCompoundActions(instruction: string): string[] {
  const actionBoundary = /\s+and\s+(?=(?:navigate|go|open|click|enter|fill|type|set|confirm|search|select|choose|verify|check|assert|wait)\b)/i;
  return instruction
    .split(actionBoundary)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isInviteEmailPrecondition(instruction: string): boolean {
  return /^open\s+(?:the\s+)?invite\s+email$/i.test(instruction);
}

function isRegistrationLinkInstruction(instruction: string): boolean {
  return /^(?:click|open)\s+(?:the\s+)?registration\s+link$/i.test(instruction);
}

function hasPayloadKey(payload: Record<string, unknown>, key: string): boolean {
  return Object.keys(payload).some((payloadKey) => payloadKey.toLowerCase() === key.toLowerCase());
}

function isRedundantSearchOpenInstruction(instruction: string): boolean {
  return /^click\s+(?:the\s+)?search$/i.test(instruction);
}

function isRedundantDropdownOpenInstruction(instruction: string): boolean {
  return /^open\s+(?:the\s+)?(?:\w+\s+)?dropdown$/i.test(instruction);
}

function extractClickOrSelectTarget(instruction: string): string | null {
  const match = instruction.match(/^(?:click|select|choose)\s+(?:on\s+)?(?:the\s+)?(.+)$/i);
  if (!match?.[1]) {
    return null;
  }

  return cleanTarget(match[1]);
}

function isGenericRowSubject(instruction: string): boolean {
  const target = instruction.replace(/^(?:click|select|choose)\s+(?:on\s+)?(?:the\s+)?/i, '').trim();
  return /^(user|record|row|item|customer|employee|member|account|entry|profile|license)$/i.test(target);
}

function hasGenericRowSubject(instruction: string): boolean {
  return /^(?:click|select|choose|open)\s+(?:on\s+)?(?:the\s+)?(?:identified\s+)?(?:user|record|row|item|customer|employee|member|account|entry|profile|license)\b/i.test(
    instruction
  );
}

function isGenericRowSelection(instruction: string): boolean {
  const target = instruction
    .replace(/^(?:click|select|choose|open)\s+(?:on\s+)?(?:the\s+)?/i, '')
    .replace(/\b(?:to|for)\s+(?:edit|delete|remove|view|details|open|disable|enable|activate|deactivate|approve|reject)\b.*$/i, '')
    .trim();

  return /^(?:identified\s+)?(?:user|record|row|item|customer|employee|member|account|entry|profile|license)$/i.test(target);
}

function splitCompoundFieldInstruction(instruction: string, payloadLabels: string[]): string[] {
  const verbMatch = instruction.match(/^(enter|fill|type)\b/i);
  const verb = titleCaseAction(verbMatch?.[1] ?? 'Enter');
  const targetText = instruction.replace(/^(enter|fill|type)\s+(?:the\s+)?/i, '').trim();
  const parts = targetText
    .split(/\s+and\s+/i)
    .map((part) => canonicalizeFieldLabel(cleanTarget(part), payloadLabels))
    .filter(Boolean);

  return parts.map((part) => `${verb} ${part}`);
}

function normalizeActionInstruction(
  instruction: string,
  payloadLabels: string[],
  payload: Record<string, unknown>
): string {
  const cleaned = cleanInstruction(instruction);

  const navigateMatch = cleaned.match(/^(?:navigate|go)\s+(?:to\s+)?(.+)$/i);
  if (navigateMatch?.[1]) {
    return `Navigate to ${canonicalizeGeneralTarget(cleanTarget(navigateMatch[1]), payloadLabels)}`;
  }

  const clickMatch = cleaned.match(/^click\s+(?:on\s+)?(?:the\s+)?(.+)$/i);
  if (clickMatch?.[1]) {
    return `Click ${canonicalizeClickTarget(cleanTarget(clickMatch[1]), payloadLabels, payload)}`;
  }

  const fillMatch = cleaned.match(/^(enter|fill|type)\s+(?:the\s+)?(.+)$/i);
  if (fillMatch?.[2]) {
    const verb = titleCaseAction(fillMatch[1]);
    return `${verb} ${canonicalizeFieldLabel(cleanTarget(fillMatch[2]), payloadLabels)}`;
  }

  const searchMatch = cleaned.match(/^search\s+(?:the\s+)?(?:user\s+)?(?:by\s+)?(.+)$/i);
  if (searchMatch?.[1]) {
    return `Enter ${canonicalizeFieldLabel(`Search by ${cleanTarget(searchMatch[1])}`, payloadLabels)}`;
  }

  const setPasswordMatch = cleaned.match(/^set\s+(?:the\s+)?password$/i);
  if (setPasswordMatch) {
    return 'Enter Password';
  }

  const confirmPasswordMatch = cleaned.match(/^confirm\s+(?:the\s+)?password$/i);
  if (confirmPasswordMatch) {
    return 'Enter Confirm Password';
  }

  const selectMatch = cleaned.match(/^(select|choose)\s+(?:the\s+)?(.+)$/i);
  if (selectMatch?.[2]) {
    if (/\bedit\b/i.test(selectMatch[2])) {
      return 'Click Edit';
    }

    // Handle "Select X: Value" pattern (e.g. "Select account type: Company")
    // The value after the colon is the actual button/option to click
    const colonValueMatch = selectMatch[2].match(/^(.+?)\s*:\s*(.+)$/);
    if (colonValueMatch?.[2]) {
      const value = colonValueMatch[2].trim();
      // Check payload for this value to canonicalize
      const payloadMatch = payloadLabels.find(l => l.toLowerCase() === value.toLowerCase());
      return `Click ${payloadMatch ?? value}`;
    }

    const verb = titleCaseAction(selectMatch[1]);
    return `${verb} ${canonicalizeFieldLabel(cleanTarget(selectMatch[2]), payloadLabels)}`;
  }

  const verifyMatch = cleaned.match(/^(verify|check|assert)\s+(?:the\s+)?(.+)$/i);
  if (verifyMatch?.[2]) {
    return `${titleCaseAction(verifyMatch[1])} ${canonicalizeGeneralTarget(cleanTarget(verifyMatch[2]), payloadLabels)}`;
  }

  return cleaned;
}

function cleanInstruction(instruction: string): string {
  return stripLeadingNumbering(instruction)
    .replace(/\bclick\s+on\b/gi, 'Click')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;]+$/, '');
}

function stripLeadingNumbering(value: string): string {
  return value
    .trim()
    .replace(/^(?:step\s*)?\d+[\).:-]\s*/i, '')
    .trim();
}

function isActionLike(segment: string): boolean {
  return actionStartPattern.test(stripLeadingNumbering(segment));
}

function cleanTarget(value: string): string {
  return value
    .replace(/\b(button|link|field|dropdown|option|page|screen|menu|section)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalizeClickTarget(target: string, payloadLabels: string[], payload: Record<string, unknown>): string {
  if (/^(user|record|row|item|customer|employee|member|account|entry|profile|license)$/i.test(target)) {
    return resolvePayloadIdentity(payload)?.identityValue ?? canonicalizeGeneralTarget(target, payloadLabels);
  }

  if (/^(menu|actions?|action menu|actions menu|more)$/i.test(target)) {
    return 'Actions Menu';
  }

  return canonicalizeGeneralTarget(target, payloadLabels);
}

function canonicalizeFieldLabel(target: string, payloadLabels: string[]): string {
  const directPayloadMatch = findPayloadLabel(target, payloadLabels);
  if (directPayloadMatch) {
    return directPayloadMatch;
  }

  return target
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function canonicalizeGeneralTarget(target: string, payloadLabels: string[]): string {
  const payloadMatch = findPayloadLabel(target, payloadLabels);
  if (payloadMatch) {
    return payloadMatch;
  }

  return target
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => preserveAcronym(word))
    .join(' ');
}

function findPayloadLabel(target: string, payloadLabels: string[]): string | null {
  const normalizedTarget = normalize(target);
  const sortedLabels = [...payloadLabels].sort((a, b) => b.length - a.length);

  return (
    sortedLabels.find((label) => normalize(label) === normalizedTarget) ??
    sortedLabels.find((label) => normalize(label).includes(normalizedTarget) || normalizedTarget.includes(normalize(label))) ??
    null
  );
}

function titleCaseAction(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized === 'go') return 'Navigate';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function preserveAcronym(word: string): string {
  if (/^[A-Z]{2,}$/.test(word)) {
    return word;
  }

  return word.charAt(0).toUpperCase() + word.slice(1);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isSecretKey(key: string): boolean {
  return /(password|passcode|secret|token|jwt|cookie|authorization|api[_-]?key)/i.test(key);
}
