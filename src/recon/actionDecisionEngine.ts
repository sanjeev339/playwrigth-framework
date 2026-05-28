import type { Locator, Page } from '@playwright/test';
import type { DomElementSnapshot, ScenarioStep } from '../types';
import { scanVisibleDom } from './domScanner';
import { parseAction, sanitizePayload } from './actionParser';
import { resolveDeterministicCandidates } from './deterministicLocatorResolver';
import { askLLMForActionDecision } from './llmActionAdvisor';
import {
  locatorFromCandidate,
  locatorFromExpression,
  validateLocatorCandidate,
  validateLocatorExpression
} from './locatorSafetyValidator';
import type {
  LLMActionDecision,
  LocatorCandidate,
  LocatorValidationResult,
  ParsedAction,
  ReconDecision
} from './reconDecisionTypes';

interface DecisionEngineInput {
  page: Page;
  scenarioId: string;
  step: ScenarioStep;
  payload: Record<string, unknown>;
  snapshotElements: DomElementSnapshot[];
  previousActionErrors?: string[];
  onIntermediateSnapshot?: (state: string, actionBeforeSnapshot: string, decision: ReconDecision) => Promise<void>;
}

export async function decideAndExecuteAction(input: DecisionEngineInput): Promise<ReconDecision> {
  const parsedAction = parseAction(input.step, input.payload);
  const decision = createBaseDecision(input.scenarioId, parsedAction);

  try {
    if (parsedAction.actionType === 'verify') {
      return {
        ...decision,
        llmReason: 'verify_only',
        actionStatus: 'skipped',
        actionError: null
      };
    }

    if (parsedAction.actionType === 'wait') {
      await waitForSettledPage(input.page);
      return {
        ...decision,
        executed: true,
        actionStatus: 'success',
        actionError: null,
        llmReason: 'safe_wait'
      };
    }

    if (parsedAction.actionType === 'unknown') {
      return {
        ...decision,
        actionStatus: 'skipped',
        actionError: 'unknown_action',
        llmReason: 'unknown_action'
      };
    }

    if (parsedAction.actionType === 'fill' && parsedAction.target === '__FORM__') {
      return executeFormFill(input, parsedAction, decision);
    }

    const deterministicCandidates = await resolveDeterministicCandidates(input.page, parsedAction, input.snapshotElements);
    const validatedCandidates = await validateCandidates(input.page, deterministicCandidates);
    const safeCandidates = deterministicCandidates.filter((candidate) =>
      validatedCandidates.some((validation) => validation.locator === candidate.locator && validation.isSafe)
    );
    console.log(`[Recon] Deterministic candidates: ${deterministicCandidates.length}`);
    console.log(`[Recon] Safe candidates: ${safeCandidates.length}`);

    decision.deterministicCandidates = deterministicCandidates;
    decision.validatedCandidates = validatedCandidates;

    const deterministicSelection = selectDeterministicSafeCandidate(safeCandidates);
    if (deterministicSelection) {
      return executeSelectedLocator(input, {
        decision,
        parsedAction,
        selectedLocator: deterministicSelection.locator,
        selectedValue: parsedAction.value,
        decisionSource: 'deterministic',
        confidence: 'high',
        selectorConfidenceScore: deterministicSelection.selectorConfidenceScore,
        selectorRisk: deterministicSelection.selectorRisk,
        selectorConfidenceSignals: deterministicSelection.selectorConfidenceSignals,
        reason:
          safeCandidates.length === 1
            ? 'Exactly one deterministic safe locator matched.'
            : 'Multiple safe locator strings matched the same UI element; selected the highest-priority locator.',
        knownCandidates: deterministicCandidates
      });
    }

    console.log('[Recon] LLM used: yes');
    const advisorDecision = await askLLMForActionDecision({
      scenarioId: input.scenarioId,
      parsedAction,
      payload: input.payload,
      visibleElements: input.snapshotElements,
      locatorCandidates: deterministicCandidates,
      validationResults: validatedCandidates,
      previousActionErrors: input.previousActionErrors
    });
    applyLLMMetadata(decision, advisorDecision);
    logLLMParseStatus(advisorDecision);

    decision.decisionSource = 'llm';
    decision.llmReason = advisorDecision.reason;
    decision.confidence = advisorDecision.confidence;
    decision.selectedLocator = advisorDecision.selectedLocator;
    decision.selectedValue = advisorDecision.value ?? parsedAction.value;
    const selectedCandidate = deterministicCandidates.find((candidate) => candidate.locator === advisorDecision.selectedLocator);
    if (selectedCandidate) {
      decision.selectorConfidenceScore = selectedCandidate.selectorConfidenceScore;
      decision.selectorRisk = selectedCandidate.selectorRisk;
      decision.selectorConfidenceSignals = selectedCandidate.selectorConfidenceSignals;
    }

    if (advisorDecision.actionType === 'skip') {
      return {
        ...decision,
        actionStatus: 'skipped',
        actionError: advisorDecision.reason
      };
    }

    if (advisorDecision.actionType === 'error' || !advisorDecision.selectedLocator) {
      return {
        ...decision,
        actionStatus: 'failed',
        actionError: advisorDecision.reason || 'LLM did not select a locator.'
      };
    }

    const selectedValidation = await validateLocatorExpression(input.page, advisorDecision.selectedLocator, deterministicCandidates);
    decision.validatedCandidates = appendValidation(decision.validatedCandidates, selectedValidation);

    if (safeCandidates.length > 0 && !safeCandidates.some((candidate) => candidate.locator === advisorDecision.selectedLocator)) {
      return {
        ...decision,
        executed: false,
        actionStatus: 'failed',
        actionError: `LLM selected locator outside safe candidate list: ${advisorDecision.selectedLocator}`
      };
    }

    if (!selectedValidation.isSafe) {
      return {
        ...decision,
        executed: false,
        actionStatus: 'failed',
        actionError: unsafeLocatorReason(selectedValidation)
      };
    }

    return executeSelectedLocator(input, {
      decision,
      parsedAction: {
        ...parsedAction,
        value: advisorDecision.value ?? parsedAction.value
      },
      selectedLocator: advisorDecision.selectedLocator,
      selectedValue: advisorDecision.value ?? parsedAction.value,
      decisionSource: 'llm',
      confidence: advisorDecision.confidence,
      selectorConfidenceScore: selectedCandidate?.selectorConfidenceScore,
      selectorRisk: selectedCandidate?.selectorRisk,
      selectorConfidenceSignals: selectedCandidate?.selectorConfidenceSignals,
      reason: advisorDecision.reason,
      knownCandidates: deterministicCandidates
    });
  } catch (error) {
    return {
      ...decision,
      actionStatus: 'failed',
      actionError: error instanceof Error ? error.message : String(error)
    };
  }
}

async function executeFormFill(
  input: DecisionEngineInput,
  parsedAction: ParsedAction,
  decision: ReconDecision
): Promise<ReconDecision> {
  const sanitizedPayload = sanitizePayload(input.payload);
  const selectedLocators: string[] = [];
  const errors: string[] = [];
  let llmUsed = false;
  let filledCount = 0;

  for (const [fieldName, value] of Object.entries(sanitizedPayload)) {
    const fieldAction: ParsedAction = {
      ...parsedAction,
      rawStep: `Fill ${fieldName}`,
      actionType: 'fill',
      target: fieldName,
      value
    };
    const visibleElements = filledCount === 0 ? input.snapshotElements : await scanVisibleDom(input.page);
    const candidates = await resolveDeterministicCandidates(input.page, fieldAction, visibleElements);
    const validations = await validateCandidates(input.page, candidates);
    const safeCandidates = candidates.filter((candidate) =>
      validations.some((validation) => validation.locator === candidate.locator && validation.isSafe)
    );

    decision.deterministicCandidates.push(...candidates);
    decision.validatedCandidates.push(...validations);

    let selectedLocator: string | null = null;
    let selectedCandidatePool = candidates;

    if (safeCandidates.length === 1) {
      selectedLocator = safeCandidates[0].locator;
    } else {
      llmUsed = true;
      const advisorDecision = await askLLMForActionDecision({
        scenarioId: input.scenarioId,
        parsedAction: fieldAction,
        payload: input.payload,
        visibleElements,
        locatorCandidates: candidates,
        validationResults: validations,
        previousActionErrors: [...(input.previousActionErrors ?? []), ...errors]
      });
      applyLLMMetadata(decision, advisorDecision);
      logLLMParseStatus(advisorDecision);
      decision.llmReason = appendReason(decision.llmReason, `${fieldName}: ${advisorDecision.reason}`);
      decision.confidence = lowerConfidence(decision.confidence, advisorDecision.confidence);
      selectedLocator = advisorDecision.selectedLocator;

      if (!selectedLocator) {
        errors.push(`${fieldName}: ${advisorDecision.reason}`);
        continue;
      }

      const validation = await validateLocatorExpression(input.page, selectedLocator, candidates);
      decision.validatedCandidates = appendValidation(decision.validatedCandidates, validation);
      if (!validation.isSafe) {
        errors.push(`${fieldName}: ${unsafeLocatorReason(validation)}`);
        continue;
      }
    }

    const locator = locatorFromExpression(input.page, selectedLocator, selectedCandidatePool);
    if (!locator) {
      errors.push(`${fieldName}: Unsupported locator ${selectedLocator}`);
      continue;
    }

    try {
      await locator.fill(value);
      selectedLocators.push(`${fieldName}: ${selectedLocator}`);
      filledCount += 1;
    } catch (error) {
      errors.push(`${fieldName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (filledCount > 0) {
    await waitForSettledPage(input.page);
  }

  return {
    ...decision,
    decisionSource: llmUsed ? 'llm' : filledCount > 0 ? 'deterministic' : 'none',
    selectedLocator: selectedLocators.length ? JSON.stringify(selectedLocators) : null,
    selectedValue: null,
    executed: filledCount > 0,
    actionStatus: errors.length === 0 && filledCount > 0 ? 'success' : errors.length > 0 ? 'failed' : 'skipped',
    actionError: errors.length ? errors.join('; ') : filledCount === 0 ? 'No payload fields were filled.' : null,
    llmReason: decision.llmReason ?? (filledCount > 0 ? `Filled ${filledCount} payload field(s).` : undefined),
    confidence: decision.confidence ?? (filledCount > 0 ? 'high' : undefined)
  };
}

async function executeSelectedLocator(
  input: DecisionEngineInput,
  options: {
    decision: ReconDecision;
    parsedAction: ParsedAction;
    selectedLocator: string;
    selectedValue: string | null;
    decisionSource: 'deterministic' | 'llm';
    confidence: 'high' | 'medium' | 'low';
    selectorConfidenceScore?: number;
    selectorRisk?: 'low' | 'medium' | 'high';
    selectorConfidenceSignals?: string[];
    reason: string;
    knownCandidates: LocatorCandidate[];
  }
): Promise<ReconDecision> {
  const locator = locatorFromExpression(input.page, options.selectedLocator, options.knownCandidates);
  if (!locator) {
    return {
      ...options.decision,
      decisionSource: options.decisionSource,
      selectedLocator: options.selectedLocator,
      selectedValue: options.selectedValue,
      llmReason: options.reason,
      confidence: options.confidence,
      selectorConfidenceScore: options.selectorConfidenceScore,
      selectorRisk: options.selectorRisk,
      selectorConfidenceSignals: options.selectorConfidenceSignals,
      actionStatus: 'failed',
      actionError: `Unsupported locator: ${options.selectedLocator}`
    };
  }

  try {
    if (options.parsedAction.actionType === 'click' || options.parsedAction.actionType === 'navigate') {
      await locator.click();
      await waitForSettledPage(input.page);
    } else if (options.parsedAction.actionType === 'fill') {
      if (!options.selectedValue) {
        throw new Error('Fill action has no value.');
      }
      await locator.fill(options.selectedValue);
      await waitForSettledPage(input.page);
    } else if (options.parsedAction.actionType === 'select') {
      if (!options.selectedValue) {
        throw new Error('Select action has no value.');
      }
      options.decision.selectedLocator = options.selectedLocator;
      options.decision.selectedValue = options.selectedValue;
      options.decision.decisionSource = options.decisionSource;
      options.decision.llmReason = options.reason;
      options.decision.confidence = options.confidence;
      const optionLocator = await executeSelectAction(input, options.parsedAction, locator, options.decision);
      options.selectedLocator = `${options.selectedLocator} -> ${optionLocator}`;
    } else {
      return {
        ...options.decision,
        decisionSource: options.decisionSource,
        selectedLocator: options.selectedLocator,
        selectedValue: options.selectedValue,
        llmReason: options.reason,
        confidence: options.confidence,
        selectorConfidenceScore: options.selectorConfidenceScore,
        selectorRisk: options.selectorRisk,
        selectorConfidenceSignals: options.selectorConfidenceSignals,
        actionStatus: 'skipped',
        actionError: `Action ${options.parsedAction.actionType} is not executable.`
      };
    }

    return {
      ...options.decision,
      parsedAction: options.parsedAction,
      decisionSource: options.decisionSource,
      selectedLocator: options.selectedLocator,
      selectedValue: options.selectedValue,
      llmReason: options.reason,
      confidence: options.confidence,
      selectorConfidenceScore: options.selectorConfidenceScore,
      selectorRisk: options.selectorRisk,
      selectorConfidenceSignals: options.selectorConfidenceSignals,
      executed: true,
      actionStatus: 'success',
      actionError: null
    };
  } catch (error) {
    return {
      ...options.decision,
      parsedAction: options.parsedAction,
      decisionSource: options.decisionSource,
      selectedLocator: options.selectedLocator,
      selectedValue: options.selectedValue,
      llmReason: options.reason,
      confidence: options.confidence,
      selectorConfidenceScore: options.selectorConfidenceScore,
      selectorRisk: options.selectorRisk,
      selectorConfidenceSignals: options.selectorConfidenceSignals,
      executed: false,
      actionStatus: 'failed',
      actionError: error instanceof Error ? error.message : String(error)
    };
  }
}

async function executeSelectAction(
  input: DecisionEngineInput,
  parsedAction: ParsedAction,
  dropdownLocator: Locator,
  decision: ReconDecision
): Promise<string> {
  await dropdownLocator.click();
  await input.page.waitForTimeout(250);

  if (input.onIntermediateSnapshot) {
    await input.onIntermediateSnapshot(
      `${parsedAction.target ?? 'select'}-dropdown-open`,
      `Open ${parsedAction.target ?? 'select'} dropdown`,
      {
        ...decision,
        selectedLocator: decision.selectedLocator,
        selectedValue: parsedAction.value,
        executed: false,
        actionStatus: 'skipped',
        actionError: null,
        llmReason: appendReason(decision.llmReason, 'Dropdown opened before option selection.')
      }
    );
  }

  const optionValue = parsedAction.value;
  if (!optionValue) {
    throw new Error('No option value was available for select action.');
  }

  const optionElements = await scanVisibleDom(input.page);
  const optionAction: ParsedAction = {
    rawStep: `Select option ${optionValue} for ${parsedAction.target ?? 'dropdown'}`,
    stepNo: parsedAction.stepNo,
    actionType: 'click',
    target: optionValue,
    value: null
  };
  const optionCandidates = await resolveDeterministicCandidates(input.page, optionAction, optionElements);
  const optionValidations = await validateCandidates(input.page, optionCandidates);
  decision.deterministicCandidates.push(...optionCandidates);
  decision.validatedCandidates.push(...optionValidations);

  const safeOptionCandidates = optionCandidates.filter((candidate) =>
    optionValidations.some((validation) => validation.locator === candidate.locator && validation.isSafe)
  );

  let selectedOptionLocator: string | null = null;
  if (safeOptionCandidates.length === 1) {
    selectedOptionLocator = safeOptionCandidates[0].locator;
  } else {
    const advisorDecision = await askLLMForActionDecision({
      scenarioId: input.scenarioId,
      parsedAction: optionAction,
      payload: input.payload,
      visibleElements: optionElements,
      locatorCandidates: optionCandidates,
      validationResults: optionValidations,
      previousActionErrors: input.previousActionErrors
    });
    applyLLMMetadata(decision, advisorDecision);
    logLLMParseStatus(advisorDecision);
    decision.llmReason = appendReason(decision.llmReason, `Option selection: ${advisorDecision.reason}`);
    decision.confidence = lowerConfidence(decision.confidence, advisorDecision.confidence);
    selectedOptionLocator = advisorDecision.selectedLocator;
  }

  if (!selectedOptionLocator) {
    throw new Error(`No safe option locator found for value "${optionValue}".`);
  }

  const selectedOptionValidation = await validateLocatorExpression(input.page, selectedOptionLocator, optionCandidates);
  decision.validatedCandidates = appendValidation(decision.validatedCandidates, selectedOptionValidation);

  if (safeOptionCandidates.length > 0 && !safeOptionCandidates.some((candidate) => candidate.locator === selectedOptionLocator)) {
    throw new Error(`LLM selected option locator outside safe candidate list: ${selectedOptionLocator}`);
  }

  if (!selectedOptionValidation.isSafe) {
    throw new Error(unsafeLocatorReason(selectedOptionValidation));
  }

  const optionLocator = locatorFromExpression(input.page, selectedOptionLocator, optionCandidates);
  if (!optionLocator) {
    throw new Error(`Unsupported option locator: ${selectedOptionLocator}`);
  }

  await optionLocator.click();
  await waitForSettledPage(input.page);
  return selectedOptionLocator;
}

async function validateCandidates(page: Page, candidates: LocatorCandidate[]): Promise<LocatorValidationResult[]> {
  const results: LocatorValidationResult[] = [];

  for (const candidate of candidates) {
    results.push(await validateLocatorCandidate(page, candidate));
  }

  return results;
}

function createBaseDecision(scenarioId: string, parsedAction: ParsedAction): ReconDecision {
  return {
    scenarioId,
    stepNo: parsedAction.stepNo,
    rawStep: parsedAction.rawStep,
    parsedAction,
    deterministicCandidates: [],
    validatedCandidates: [],
    decisionSource: 'none',
    selectedLocator: null,
    selectedValue: parsedAction.value,
    executed: false,
    actionStatus: 'skipped',
    actionError: null,
    llmParseError: null,
    llmRetryUsed: false,
    llmRetryStatus: 'not_used',
    timestamp: new Date().toISOString()
  };
}

function selectDeterministicSafeCandidate(safeCandidates: LocatorCandidate[]): LocatorCandidate | null {
  if (safeCandidates.length === 0) {
    return null;
  }

  const sorted = [...safeCandidates].sort((left, right) => left.priority - right.priority);
  if (sorted.length === 1) {
    return sorted[0];
  }

  const top = sorted[0];
  if (isStrongSemanticCandidate(top)) {
    return top;
  }

  const elementIndexes = new Set(
    sorted
      .map((candidate) => candidate.elementSummary?.index)
      .filter((index): index is number => typeof index === 'number')
  );

  return elementIndexes.size === 1 ? sorted[0] : null;
}

function isStrongSemanticCandidate(candidate: LocatorCandidate): boolean {
  return (
    candidate.priority <= 30 &&
    ['getByTestId', 'getByRole', 'getByLabel', 'getByPlaceholder', 'getByText'].includes(candidate.locatorType)
  );
}

function applyLLMMetadata(decision: ReconDecision, advisorDecision: LLMActionDecision): void {
  decision.llmRawResponsePreview = advisorDecision.rawResponsePreview;
  decision.llmParseError = advisorDecision.parseError ?? null;
  decision.llmRetryUsed = advisorDecision.retryUsed ?? false;
  decision.llmRetryStatus = advisorDecision.retryStatus ?? 'not_used';
}

function logLLMParseStatus(advisorDecision: LLMActionDecision): void {
  const parseStatus = advisorDecision.parseError ? 'failed' : 'success';
  console.log(`[Recon] LLM parse status: ${parseStatus}`);
  if (advisorDecision.parseError) {
    console.log(`[Recon] LLM parse error: ${advisorDecision.parseError}`);
    console.log(`[Recon] LLM raw response preview: ${advisorDecision.rawResponsePreview ?? ''}`);
    console.log(`[Recon] LLM correction retry status: ${advisorDecision.retryStatus ?? 'not_used'}`);
  }
}

function appendValidation(
  validations: LocatorValidationResult[],
  nextValidation: LocatorValidationResult
): LocatorValidationResult[] {
  const index = validations.findIndex((validation) => validation.locator === nextValidation.locator);
  if (index === -1) {
    return [...validations, nextValidation];
  }

  const updated = [...validations];
  updated[index] = nextValidation;
  return updated;
}

function unsafeLocatorReason(validation: LocatorValidationResult): string {
  if (validation.count === 0) {
    return `action_error: ${validation.reason}`;
  }
  if (validation.count > 1) {
    return `strict_mode_risk: ${validation.reason}`;
  }
  return validation.reason;
}

async function waitForSettledPage(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(250);
}

function appendReason(existing: string | undefined, next: string): string {
  return existing ? `${existing} ${next}` : next;
}

function lowerConfidence(
  current: 'high' | 'medium' | 'low' | undefined,
  next: 'high' | 'medium' | 'low'
): 'high' | 'medium' | 'low' {
  const rank = { high: 3, medium: 2, low: 1 };
  if (!current) {
    return next;
  }
  return rank[next] < rank[current] ? next : current;
}
