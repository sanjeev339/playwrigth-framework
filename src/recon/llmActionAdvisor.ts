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
    logLLMInfo('SKIPPED', input, llmDisabledReason);
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
    logLLMExchange('REQUEST', input, prompt, promptTokenEstimate);
    const response = await callLLM(prompt);
    const responseTokenEstimate = estimateTokens(response);
    logLLMExchange('RESPONSE', input, response, responseTokenEstimate);
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
    logLLMExchange('CORRECTION_REQUEST', input, correctionPrompt, correctionPromptTokenEstimate);
    const correctionResponse = await callLLM(correctionPrompt);
    const correctionResponseTokenEstimate = estimateTokens(correctionResponse);
    logLLMExchange('CORRECTION_RESPONSE', input, correctionResponse, correctionResponseTokenEstimate);
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
    testId: element.dataTestId || element.dataTest || element.dataCy || element.dataQa,
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
      '- selectedLocator must be one of the provided candidate locator strings when possible.',
      '- If no safe locator is available, return actionType "error" and selectedLocator null.',
      '',
      'Scenario ID:',
      input.scenarioId,
      '',
      'Current Step:',
      input.parsedAction.rawStep,
      '',
      'Parsed Action:',
      JSON.stringify(input.parsedAction, null, 2),
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
      '1. Prefer locator candidates already provided.',
      '2. Prefer getByRole, getByLabel, getByPlaceholder, getByTestId.',
      '3. Avoid XPath unless no safer option exists.',
      '4. Do not choose a locator that validation says is unsafe.',
      '5. If multiple candidates are safe, choose the one most semantically related to the current step.',
      '6. If no safe locator exists, return actionType "error" and selectedLocator null.',
      '7. Do not modify business flow.',
      '8. Do not use secrets.',
      '9. Return JSON only.',
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

function logLLMExchange(
  direction: 'REQUEST' | 'RESPONSE' | 'CORRECTION_REQUEST' | 'CORRECTION_RESPONSE',
  input: LLMAdvisorInput,
  content: string,
  tokenEstimate: number
): void {
  const config = getLLMLoggingConfig();
  if (!config.LOG_LLM_IO) {
    return;
  }

  const safeContent = truncate(redactSecrets(content), config.LLM_IO_MAX_CHARS);
  const metadata = [
    `scenario=${input.scenarioId}`,
    `step=${input.parsedAction.stepNo}`,
    `action=${input.parsedAction.actionType}`,
    `target=${input.parsedAction.target ?? ''}`,
    `candidates=${input.locatorCandidates.length}`,
    `validations=${input.validationResults.length}`,
    `estimatedTokens=${tokenEstimate}`
  ].join(' ');

  logger.info(
    [
      `[LLM][${direction}] ${metadata}`,
      `----- ${direction} START -----`,
      safeContent,
      `----- ${direction} END -----`
    ].join('\n')
  );
}

function logLLMInfo(kind: 'SKIPPED', input: LLMAdvisorInput, message: string): void {
  const config = getLLMLoggingConfig();
  if (!config.LOG_LLM_IO) {
    return;
  }

  logger.info(
    `[LLM][${kind}] scenario=${input.scenarioId} step=${input.parsedAction.stepNo} action=${input.parsedAction.actionType} reason=${redactSecrets(message)}`
  );
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function isQuotaExhausted(message: string): boolean {
  return /quota|resource_exhausted|free_tier_requests|exceeded your current quota/i.test(message);
}
