import type { ScenarioStep } from '../types';

export interface NormalizedStep extends ScenarioStep {
  step_no: number;
  instruction: string;
  raw_instruction: string;
  normalization_strategy?: string;
  normalization_context_from_previous?: boolean;
}

type NormalizerInput = Pick<ScenarioStep, 'step_no' | 'instruction' | 'expected_result'>;

const actionStartPattern = /^(navigate|go to|click|enter|fill|type|select|choose|verify|check|assert|wait|open|change|save)\b/i;

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
      const atomicInstructions = splitCompoundInstruction(cleanInstruction(segment), payloadLabels);

      for (const atomicInstruction of atomicInstructions) {
        if (!atomicInstruction.instruction) {
          continue;
        }

        normalized.push({
          step_no: normalized.length + 1,
          instruction: atomicInstruction.instruction,
          raw_instruction: rawInstruction,
          expected_result: step.expected_result,
          normalization_strategy: atomicInstruction.strategy,
          normalization_context_from_previous: atomicInstruction.contextFromPrevious
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

  if (semicolonSegments.length > 1 && semicolonSegments.every(isActionLike)) {
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
  payloadLabels: string[]
): Array<{ instruction: string; strategy: string; contextFromPrevious: boolean }> {
  const normalizedInstruction = cleanInstruction(instruction);
  const chained = splitMixedVerbChain(normalizedInstruction);
  if (chained.length > 1) {
    return chained
      .map((part, index) => ({
        instruction: normalizeActionInstruction(part, payloadLabels),
        strategy: 'action_graph_chain_split',
        contextFromPrevious: index > 0
      }))
      .filter((part) => Boolean(part.instruction));
  }

  if (/^click\b/i.test(normalizedInstruction) && /\band\s+click\b/i.test(normalizedInstruction)) {
    return normalizedInstruction
      .split(/\s+and\s+(?=click\b)/i)
      .map((part, index) => ({
        instruction: normalizeActionInstruction(part, payloadLabels),
        strategy: 'compound_click_split',
        contextFromPrevious: index > 0
      }))
      .filter((part) => Boolean(part.instruction));
  }

  if (/^(enter|fill|type)\b/i.test(normalizedInstruction) && /\s+and\s+/i.test(normalizedInstruction)) {
    return splitCompoundFieldInstruction(normalizedInstruction, payloadLabels).map((part, index) => ({
      instruction: part,
      strategy: 'compound_field_split',
      contextFromPrevious: index > 0
    }));
  }

  return [
    {
      instruction: normalizeActionInstruction(normalizedInstruction, payloadLabels),
      strategy: 'direct_normalization',
      contextFromPrevious: false
    }
  ].filter((part) => Boolean(part.instruction));
}

function splitMixedVerbChain(instruction: string): string[] {
  const verbs = '(?:click|select|choose|enter|fill|type|verify|check|assert|wait|navigate|go\\s+to|open|change|save)';
  const normalized = instruction.replace(/\s+/g, ' ').trim();
  const parts = normalized
    .split(new RegExp(`\\s+and\\s+(?=${verbs}\\b)`, 'i'))
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : [normalized];
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

function normalizeActionInstruction(instruction: string, payloadLabels: string[]): string {
  const cleaned = cleanInstruction(instruction);

  const navigateMatch = cleaned.match(/^(?:navigate|go)\s+(?:to\s+)?(.+)$/i);
  if (navigateMatch?.[1]) {
    return `Navigate to ${canonicalizeGeneralTarget(cleanTarget(navigateMatch[1]), payloadLabels)}`;
  }

  const clickMatch = cleaned.match(/^click\s+(?:on\s+)?(?:the\s+)?(.+)$/i);
  if (clickMatch?.[1]) {
    return `Click ${canonicalizeGeneralTarget(cleanTarget(clickMatch[1]), payloadLabels)}`;
  }

  const fillMatch = cleaned.match(/^(enter|fill|type)\s+(?:the\s+)?(.+)$/i);
  if (fillMatch?.[2]) {
    const verb = titleCaseAction(fillMatch[1]);
    return `${verb} ${canonicalizeFieldLabel(cleanTarget(fillMatch[2]), payloadLabels)}`;
  }

  const selectMatch = cleaned.match(/^(select|choose)\s+(?:the\s+)?(.+)$/i);
  if (selectMatch?.[2]) {
    const verb = titleCaseAction(selectMatch[1]);
    return `${verb} ${canonicalizeFieldLabel(cleanTarget(selectMatch[2]), payloadLabels)}`;
  }

  const openMatch = cleaned.match(/^open\s+(?:the\s+)?(.+)$/i);
  if (openMatch?.[1]) {
    return `Click ${canonicalizeGeneralTarget(cleanTarget(openMatch[1]), payloadLabels)}`;
  }

  const changeMatch = cleaned.match(/^change\s+(?:the\s+)?(.+)$/i);
  if (changeMatch?.[1]) {
    return `Click ${canonicalizeGeneralTarget(cleanTarget(changeMatch[1]), payloadLabels)}`;
  }

  const saveMatch = cleaned.match(/^save\s+(.+)$/i);
  if (saveMatch?.[1]) {
    return `Click Save ${canonicalizeGeneralTarget(cleanTarget(saveMatch[1]), payloadLabels)}`;
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
    .replace(/\.$/, '');
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

function canonicalizeFieldLabel(target: string, payloadLabels: string[]): string {
  const directPayloadMatch = findPayloadLabel(target, payloadLabels);
  if (directPayloadMatch) {
    return directPayloadMatch;
  }

  const titleCased = target
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

  return commonLabelFixups(titleCased);
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

function commonLabelFixups(value: string): string {
  return value
    .replace(/\bFirst name\b/i, 'First Name')
    .replace(/\bLast name\b/i, 'Last Name')
    .replace(/\bEmail address\b/i, 'Email Address');
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
