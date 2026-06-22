import { z } from 'zod';
import { getLLMLoggingConfig } from '../config/env';
import type { DomElementSnapshot } from '../types';
import { callLLM } from '../llm/llmClient';
import { truncate } from '../utils/fileUtils';
import { logger, redactSecrets } from '../utils/logger';
import { sanitizePayload } from './actionParser';
import type {
  LLMActionDecision,
  LocatorCandidate,
  LocatorValidationResult,
  ParsedAction
} from './reconDecisionTypes';

interface LLMAdvisorInput {
  scenarioId: string;
  parsedAction: ParsedAction;
  payload: Record<string, unknown>;
  visibleElements: DomElementSnapshot[];
  locatorCandidates: LocatorCandidate[];
  validationResults: LocatorValidationResult[];
  previousActionErrors?: string[];
}

const allowedActionTypes = ['click', 'navigate', 'fill', 'select', 'verify', 'wait', 'row_action', 'skip', 'error'] as const;

const decisionSchema = z.object({
  actionType: z.enum(allowedActionTypes),
  target: z.string().default(''),
  value: z.string().nullable().default(null),
  selectedLocator: z.string().nullable().default(null),
  reason: z.string().default('No reason supplied.'),
  confidence: z.enum(['high', 'medium', 'low']).default('low')
});

let llmDisabledReason: string | null = null;

export async function askLLMForActionDecision(input: LLMAdvisorInput): Promise<LLMActionDecision> {
  const prompt = buildPrompt(input);
  const promptTokenEstimate = estimateTokens(prompt);

  if (llmDisabledReason) {
    logAdvisorMetadata('SKIPPED', input, 0, llmDisabledReason);
    return {
      actionType: 'error',
      target: input.parsedAction.target ?? '',
      value: input.parsedAction.value,
      selectedLocator: null,
      reason: llmDisabledReason,
      confidence: 'low',
      rawResponsePreview: '',
      parseError: llmDisabledReason,
      retryUsed: false,
      retryStatus: 'not_used',
      promptTokenEstimate: 0,
      responseTokenEstimate: 0,
      totalTokenEstimate: 0
    };
  }

  try {
    logAdvisorMetadata('REQUEST', input, promptTokenEstimate);
    const response = await callLLM(prompt, 'advisor');
    const responseTokenEstimate = estimateTokens(response);
    logAdvisorMetadata('RESPONSE', input, responseTokenEstimate);
    const firstParse = parseLLMDecision(response);

    if (!firstParse.parseError) {
      return {
        ...firstParse,
        retryUsed: false,
        retryStatus: 'not_used',
        promptTokenEstimate,
        responseTokenEstimate,
        totalTokenEstimate: promptTokenEstimate + responseTokenEstimate
      };
    }

    logger.warn(`[Recon] LLM parse failed: ${firstParse.parseError}`);
    logger.warn(`[Recon] LLM raw response preview: ${firstParse.rawResponsePreview ?? ''}`);

    const correctionPrompt = buildCorrectionPrompt(response);
    const correctionPromptTokenEstimate = estimateTokens(correctionPrompt);
    logAdvisorMetadata('CORRECTION_REQUEST', input, correctionPromptTokenEstimate);
    const correctionResponse = await callLLM(correctionPrompt, 'advisor');
    const correctionResponseTokenEstimate = estimateTokens(correctionResponse);
    logAdvisorMetadata('CORRECTION_RESPONSE', input, correctionResponseTokenEstimate);
    const secondParse = parseLLMDecision(correctionResponse);
    const totalPromptTokenEstimate = promptTokenEstimate + correctionPromptTokenEstimate;
    const totalResponseTokenEstimate = responseTokenEstimate + correctionResponseTokenEstimate;

    if (!secondParse.parseError) {
      logger.info('[Recon] LLM JSON correction retry succeeded.');
      return {
        ...secondParse,
        rawResponsePreview: secondParse.rawResponsePreview ?? preview(correctionResponse),
        parseError: null,
        retryUsed: true,
        retryStatus: 'success',
        promptTokenEstimate: totalPromptTokenEstimate,
        responseTokenEstimate: totalResponseTokenEstimate,
        totalTokenEstimate: totalPromptTokenEstimate + totalResponseTokenEstimate
      };
    }

    logger.warn(`[Recon] LLM JSON correction retry failed: ${secondParse.parseError}`);
    return {
      ...secondParse,
      actionType: 'error',
      target: input.parsedAction.target ?? '',
      value: input.parsedAction.value,
      selectedLocator: null,
      reason: `LLM response could not be parsed as strict JSON after retry: ${secondParse.parseError}`,
      confidence: 'low',
      rawResponsePreview: secondParse.rawResponsePreview ?? preview(correctionResponse),
      parseError: secondParse.parseError,
      retryUsed: true,
      retryStatus: 'failed',
      promptTokenEstimate: totalPromptTokenEstimate,
      responseTokenEstimate: totalResponseTokenEstimate,
      totalTokenEstimate: totalPromptTokenEstimate + totalResponseTokenEstimate
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (isQuotaExhausted(reason)) {
      llmDisabledReason = `LLM fallback disabled for this run because provider quota is exhausted: ${reason}`;
    }
    logger.warn('LLM action advisor failed.', error);
    return {
      actionType: 'error',
      target: input.parsedAction.target ?? '',
      value: input.parsedAction.value,
      selectedLocator: null,
      reason,
      confidence: 'low',
      rawResponsePreview: '',
      parseError: reason,
      retryUsed: false,
      retryStatus: 'not_used',
      promptTokenEstimate,
      responseTokenEstimate: 0,
      totalTokenEstimate: promptTokenEstimate
    };
  }
}

export function extractJsonObject(text: string): string {
  const withoutFences = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const firstBrace = withoutFences.indexOf('{');
  const lastBrace = withoutFences.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('No valid JSON object boundaries found in LLM response.');
  }

  return withoutFences.slice(firstBrace, lastBrace + 1);
}

export function parseLLMDecision(raw: string): LLMActionDecision {
  const rawResponsePreview = preview(raw);

  try {
    const jsonText = extractJsonObject(raw);
    const parsedUnknown = JSON.parse(jsonText) as Record<string, unknown>;

    if (!parsedUnknown.actionType || !allowedActionTypes.includes(parsedUnknown.actionType as (typeof allowedActionTypes)[number])) {
      throw new Error(`Invalid or missing actionType: ${String(parsedUnknown.actionType)}`);
    }

    const normalized = {
      actionType: parsedUnknown.actionType,
      target: typeof parsedUnknown.target === 'string' ? parsedUnknown.target : '',
      value: typeof parsedUnknown.value === 'string' ? parsedUnknown.value : null,
      selectedLocator: typeof parsedUnknown.selectedLocator === 'string' ? parsedUnknown.selectedLocator : null,
      reason: typeof parsedUnknown.reason === 'string' ? parsedUnknown.reason : 'No reason supplied.',
      confidence: ['high', 'medium', 'low'].includes(String(parsedUnknown.confidence)) ? parsedUnknown.confidence : 'low'
    };

    const result = decisionSchema.safeParse(normalized);
    if (!result.success) {
      throw new Error(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    }

    return {
      ...result.data,
      rawResponsePreview,
      parseError: null,
      retryUsed: false,
      retryStatus: 'not_used'
    };
  } catch (error) {
    const parseError = error instanceof Error ? error.message : String(error);
    return {
      actionType: 'error',
      target: '',
      value: null,
      selectedLocator: null,
      reason: `Invalid LLM JSON: ${parseError}`,
      confidence: 'low',
      rawResponsePreview,
      parseError,
      retryUsed: false,
      retryStatus: 'not_used'
    };
  }
}

import { getFrameworkConfig } from '../config/configLoader';

function getFirstTestId(element: DomElementSnapshot): string | undefined {
  const config = getFrameworkConfig();
  if (!element.testAttributes) return undefined;
  for (const attr of config.locator.testIdAttributes) {
    if (element.testAttributes[attr]) {
      return element.testAttributes[attr];
    }
  }
  return undefined;
}

function buildPrompt(input: LLMAdvisorInput): string {
  const visibleElements = input.visibleElements.map((element) => ({
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
    title: element.title,
    testId: getFirstTestId(element),
    locatorPriority: element.locatorPriority
  }));

  const locatorCandidates = input.locatorCandidates.map((candidate) => ({
    locator: candidate.locator,
    locatorType: candidate.locatorType,
    priority: candidate.priority,
    source: candidate.source,
    elementSummary: candidate.elementSummary
  }));

  return truncate(
    [
      'You are an expert Playwright UI automation advisor.',
      '',
      'You are helping a recon engine decide the next safe UI action.',
      '',
      'STRICT OUTPUT RULES:',
      '- Return only one raw JSON object.',
      '- Do not wrap in Markdown.',
      '- Do not use ```json fences.',
      '- Do not include explanation outside JSON.',
      '- Do not use comments.',
      '- Do not use trailing commas.',
      '- Use null, not undefined.',
      '- Try to use an exact locator string from Locator Candidates if it is a good match.',
      '- If no candidate is a good match, you MAY synthesize a valid Playwright locator based on the most similar/highest match element found in Visible UI Elements.',
      '- If no safe locator is available anywhere, return actionType "error" and selectedLocator null.',
      '',
      'Scenario ID:',
      input.scenarioId,
      '',
      'Current Step:',
      input.parsedAction.rawStep,
      '',
      'Parsed Action:',
      JSON.stringify(sanitizeParsedActionForPrompt(input.parsedAction), null, 2),
      '',
      'Payload:',
      JSON.stringify(sanitizePayload(input.payload), null, 2),
      '',
      'Visible UI Elements:',
      JSON.stringify(visibleElements, null, 2),
      '',
      'Locator Candidates:',
      JSON.stringify(locatorCandidates, null, 2),
      '',
      'Validation Results:',
      JSON.stringify(input.validationResults, null, 2),
      '',
      'Previous Action Errors:',
      JSON.stringify(input.previousActionErrors ?? [], null, 2),
      '',
      'Decision Rules:',
      '1. First, evaluate the Locator Candidates. If one is a strong match, use it exactly.',
      '2. If no candidate is a perfect fit, find the element in Visible UI Elements that is the highest match/most similar to the target.',
      '3. When synthesizing a locator, prefer getByRole, getByLabel, getByPlaceholder, getByText, getByTestId.',
      '4. Avoid XPath unless absolutely necessary.',
      '5. If multiple candidates or elements are safe, choose the one most semantically related to the current step.',
      '6. If no element matches the intent safely, return actionType "error" and selectedLocator null.',
      '7. Do not modify business flow.',
      '8. Do not use secrets.',
      '9. For dropdown option selections, prefer exact text matching to avoid ambiguous matches with other buttons on the page.',
      '10. Return JSON only.',
      '',
      'Required JSON schema:',
      '{',
      '  "actionType": "click" | "navigate" | "fill" | "select" | "verify" | "wait" | "row_action" | "skip" | "error",',
      '  "target": "string",',
      '  "value": "string | null",',
      '  "selectedLocator": "string | null",',
      '  "reason": "string",',
      '  "confidence": "high" | "medium" | "low"',
      '}'
    ].join('\n'),
    80_000
  );
}

function sanitizeParsedActionForPrompt(parsedAction: ParsedAction): ParsedAction {
  if (!parsedAction.isSensitiveValue) {
    return parsedAction;
  }

  return {
    ...parsedAction,
    value: parsedAction.value === null ? null : '[REDACTED]'
  };
}

function buildCorrectionPrompt(invalidResponse: string): string {
  return truncate(
    [
      'Your previous response was invalid JSON. Convert it into one valid JSON object matching this schema.',
      'Return JSON only. Do not include Markdown.',
      '',
      'Schema:',
      '{',
      '  "actionType": "click" | "navigate" | "fill" | "select" | "verify" | "wait" | "row_action" | "skip" | "error",',
      '  "target": "string",',
      '  "value": "string | null",',
      '  "selectedLocator": "string | null",',
      '  "reason": "string",',
      '  "confidence": "high" | "medium" | "low"',
      '}',
      '',
      'Invalid response:',
      redactSecrets(invalidResponse)
    ].join('\n'),
    20_000
  );
}

function preview(value: string): string {
  return redactSecrets(value).slice(0, 500);
}

function logAdvisorMetadata(
  direction: 'REQUEST' | 'RESPONSE' | 'CORRECTION_REQUEST' | 'CORRECTION_RESPONSE' | 'SKIPPED',
  input: LLMAdvisorInput,
  tokenEstimate: number,
  skippedReason?: string
): void {
  const config = getLLMLoggingConfig();
  if (!config.LOG_LLM_IO) {
    return;
  }

  const metadata = [
    `scenario=${input.scenarioId}`,
    `step=${input.parsedAction.stepNo}`,
    `action=${input.parsedAction.actionType}`,
    `target=${input.parsedAction.target ?? ''}`,
    `candidates=${input.locatorCandidates.length}`,
    `validations=${input.validationResults.length}`,
    `estimatedTokens=${tokenEstimate}`
  ].join(' ');

  const reasonStr = skippedReason ? ` reason=${redactSecrets(skippedReason)}` : '';
  logger.info(`[LLM][${direction}] ${metadata}${reasonStr}`);
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function isQuotaExhausted(message: string): boolean {
  return /quota|resource_exhausted|free_tier_requests|exceeded your current quota/i.test(message);
}
