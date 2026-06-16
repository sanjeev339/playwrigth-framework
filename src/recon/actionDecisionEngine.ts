import type { Locator, Page } from '@playwright/test';
import { getActionDecisionMode } from '../config/env';
import type { DomElementSnapshot, ScenarioStep, FrontendStepIssue } from '../types';
import { scanVisibleDom } from './domScanner';
import { isSecretPayloadKey, parseAction } from './actionParser';
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
import { collectStepIssues } from '../reports/frontendReviewReporter';

interface DecisionEngineInput {
  page: Page;
  scenarioId: string;
  step: ScenarioStep;
  payload: Record<string, unknown>;
  snapshotElements: DomElementSnapshot[];
  previousActionErrors?: string[];
  isLastStep?: boolean;
  onIntermediateSnapshot?: (state: string, actionBeforeSnapshot: string, decision: ReconDecision) => Promise<void>;
  onFrontendIssue?: (issues: FrontendStepIssue[]) => void;
}

export async function decideAndExecuteAction(input: DecisionEngineInput): Promise<ReconDecision> {
  const decision = await _decideAndExecuteAction(input);
  if (input.onFrontendIssue) {
    const parsedAction = parseAction(input.step, input.payload);
    const issues = collectStepIssues(
      input.scenarioId,
      input.step,
      parsedAction,
      decision,
      input.snapshotElements
    );
    if (issues.length > 0) {
      input.onFrontendIssue(issues);
    }
  }
  return decision;
}

async function _decideAndExecuteAction(input: DecisionEngineInput): Promise<ReconDecision> {
  const parsedAction = parseAction(input.step, input.payload);
  const decision = createBaseDecision(input.scenarioId, parsedAction);
  const decisionMode = getActionDecisionMode();

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

    if (parsedAction.actionType === 'navigate' && parsedAction.value && isHttpUrl(parsedAction.value)) {
      await input.page.goto(parsedAction.value, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await waitForSettledPage(input.page);
      return {
        ...decision,
        decisionSource: 'deterministic',
        selectedLocator: null,
        selectedValue: null,
        executed: true,
        actionStatus: 'success',
        actionError: null,
        llmReason: `Navigated directly to URL from payload key "${parsedAction.payloadKey ?? parsedAction.target ?? 'unknown'}".`,
        confidence: 'high'
      };
    }

    if (parsedAction.actionType === 'navigate' && parsedAction.target && /registration\s+link/i.test(parsedAction.target)) {
      return {
        ...decision,
        decisionSource: 'deterministic',
        selectedLocator: null,
        selectedValue: null,
        executed: false,
        actionStatus: 'failed',
        actionError: 'Registration Link payload must be set to a real http(s) invite URL before this scenario can run.',
        llmReason: 'registration_link_missing',
        confidence: 'high'
      };
    }

    if (parsedAction.actionType === 'unknown') {
      if (decisionMode === 'llm_first') {
        return executeLlmSelectedAction(input, decision, parsedAction, [], [], []);
      }

      return {
        ...decision,
        actionStatus: 'skipped',
        actionError: 'unknown_action',
        llmReason: 'unknown_action'
      };
    }

    if (parsedAction.actionType === 'fill' && parsedAction.target === '__FORM__') {
      return executeFormFill(input, parsedAction, decision, decisionMode);
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

    const strongDeterministicSelection = selectStrongDeterministicCandidate(safeCandidates);
    if (strongDeterministicSelection) {
      return executeSelectedLocator(input, {
        decision,
        parsedAction,
        selectedLocator: strongDeterministicSelection.locator,
        selectedValue: parsedAction.value,
        decisionSource: 'deterministic',
        confidence: 'high',
        selectorConfidenceScore: strongDeterministicSelection.selectorConfidenceScore,
        selectorRisk: strongDeterministicSelection.selectorRisk,
        selectorConfidenceSignals: strongDeterministicSelection.selectorConfidenceSignals,
        reason: 'Selected one strong deterministic safe locator before LLM fallback.',
        knownCandidates: deterministicCandidates,
        isLastStep: input.isLastStep
      });
    }

    if (decisionMode === 'llm_first') {
      console.log('[Recon] LLM used: yes (llm_first)');
      return executeLlmSelectedAction(input, decision, parsedAction, deterministicCandidates, validatedCandidates, safeCandidates);
    }

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
        knownCandidates: deterministicCandidates,
        isLastStep: input.isLastStep
      });
    }

    const disabledTargetReason = disabledTargetValidationReason(deterministicCandidates, validatedCandidates);
    if (disabledTargetReason) {
      return {
        ...decision,
        decisionSource: 'deterministic',
        selectedLocator: disabledTargetReason.locator,
        selectedValue: parsedAction.value,
        llmReason: 'Matching UI target is present but disabled; LLM fallback skipped.',
        confidence: 'high',
        executed: false,
        actionStatus: 'failed',
        actionError: disabledTargetReason.reason
      };
    }

    console.log('[Recon] LLM used: yes');
    return executeLlmSelectedAction(input, decision, parsedAction, deterministicCandidates, validatedCandidates, safeCandidates);
  } catch (error) {
    return {
      ...decision,
      actionStatus: 'failed',
      actionError: error instanceof Error ? error.message : String(error)
    };
  }
}

async function executeLlmSelectedAction(
  input: DecisionEngineInput,
  decision: ReconDecision,
  parsedAction: ParsedAction,
  deterministicCandidates: LocatorCandidate[],
  validatedCandidates: LocatorValidationResult[],
  safeCandidates: LocatorCandidate[]
): Promise<ReconDecision> {
  if (safeCandidates.length === 0) {
    return {
      ...decision,
      decisionSource: 'llm',
      executed: false,
      actionStatus: 'failed',
      actionError: 'No safe validated locator candidates are available for the LLM to choose.'
    };
  }

  let advisorDecision = await askLLMForActionDecision({
    scenarioId: input.scenarioId,
    parsedAction,
    payload: input.payload,
    visibleElements: input.snapshotElements,
    locatorCandidates: safeCandidates,
    validationResults: safeValidationResults(safeCandidates, validatedCandidates),
    previousActionErrors: input.previousActionErrors
  });
  applyLLMMetadata(decision, advisorDecision);
  logLLMParseStatus(advisorDecision);

  if (!isSafeCandidateSelection(advisorDecision.selectedLocator, safeCandidates)) {
    const rejectedLocator = advisorDecision.selectedLocator ?? 'null';
    console.log(`[Recon] LLM selected outside safe candidates; retrying with safe-only candidates: ${rejectedLocator}`);
    advisorDecision = await askLLMForActionDecision({
      scenarioId: input.scenarioId,
      parsedAction,
      payload: input.payload,
      visibleElements: [],
      locatorCandidates: safeCandidates,
      validationResults: safeValidationResults(safeCandidates, validatedCandidates),
      previousActionErrors: [
        ...(input.previousActionErrors ?? []),
        `Rejected locator "${rejectedLocator}". selectedLocator must exactly copy one locator from the safe Locator Candidates list.`
      ]
    });
    applyLLMMetadata(decision, advisorDecision);
    logLLMParseStatus(advisorDecision);
  }

  decision.deterministicCandidates = deterministicCandidates;
  decision.validatedCandidates = validatedCandidates;
  decision.decisionSource = 'llm';
  decision.llmReason = advisorDecision.reason;
  decision.confidence = advisorDecision.confidence;
  decision.selectedLocator = advisorDecision.selectedLocator;
  decision.selectedValue = parsedAction.isSensitiveValue ? parsedAction.value : advisorDecision.value ?? parsedAction.value;
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

  if (!isSafeCandidateSelection(advisorDecision.selectedLocator, safeCandidates)) {
    return {
      ...decision,
      executed: false,
      actionStatus: 'failed',
      actionError: `LLM failed to select an exact safe candidate after retry: ${advisorDecision.selectedLocator ?? 'null'}`
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
      actionType: advisorDecision.actionType,
      target: advisorDecision.target || parsedAction.target,
      value: parsedAction.isSensitiveValue ? parsedAction.value : advisorDecision.value ?? parsedAction.value
    },
    selectedLocator: advisorDecision.selectedLocator,
    selectedValue: parsedAction.isSensitiveValue ? parsedAction.value : advisorDecision.value ?? parsedAction.value,
    decisionSource: 'llm',
    confidence: advisorDecision.confidence,
    selectorConfidenceScore: selectedCandidate?.selectorConfidenceScore,
    selectorRisk: selectedCandidate?.selectorRisk,
    selectorConfidenceSignals: selectedCandidate?.selectorConfidenceSignals,
    reason: advisorDecision.reason,
    knownCandidates: deterministicCandidates,
    isLastStep: input.isLastStep
  });
}

async function executeFormFill(
  input: DecisionEngineInput,
  parsedAction: ParsedAction,
  decision: ReconDecision,
  decisionMode: ReturnType<typeof getActionDecisionMode>
): Promise<ReconDecision> {
  const selectedLocators: string[] = [];
  const errors: string[] = [];
  let llmUsed = false;
  let filledCount = 0;

  for (const [fieldName, rawValue] of Object.entries(input.payload)) {
    if (rawValue === undefined || rawValue === null || isRuntimeOnlyPayloadKey(fieldName)) {
      continue;
    }

    const value = String(rawValue);
    const isSensitiveField = isSecretPayloadKey(fieldName);
    const fieldAction: ParsedAction = {
      ...parsedAction,
      rawStep: `Fill ${fieldName}`,
      actionType: 'fill',
      target: fieldName,
      value,
      payloadKey: fieldName,
      isSensitiveValue: isSensitiveField
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

    if ((decisionMode === 'deterministic_first' || isSensitiveField) && safeCandidates.length === 1) {
      selectedLocator = safeCandidates[0].locator;
    } else if (isSensitiveField) {
      errors.push(`${fieldName}: Sensitive field requires exactly one deterministic safe locator; LLM fallback skipped.`);
      continue;
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
    isLastStep?: boolean;
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

  // Recon dry-run: locator discovered and validated, but the final action is skipped
  // to prevent database mutations (e.g. user creation) during the discovery phase.
  if (process.env['IS_RECON'] === 'true' && options.isLastStep) {
    console.log(`[Recon] Last step dry-run: skipping execution of "${options.parsedAction.actionType}" on "${options.selectedLocator}" to avoid mutation.`);
    return {
      ...options.decision,
      decisionSource: options.decisionSource,
      selectedLocator: options.selectedLocator,
      selectedValue: options.selectedValue,
      llmReason: `${options.reason} (Skipped execution in recon mode — final step dry-run)`,
      confidence: options.confidence,
      selectorConfidenceScore: options.selectorConfidenceScore,
      selectorRisk: options.selectorRisk,
      selectorConfidenceSignals: options.selectorConfidenceSignals,
      executed: false,
      actionStatus: 'success',
      actionError: null
    };
  }

  try {
    if (
      options.parsedAction.actionType === 'click' ||
      options.parsedAction.actionType === 'navigate' ||
      options.parsedAction.actionType === 'row_action'
    ) {
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
      options.decision.dropdownLocator = options.selectedLocator;
      options.decision.optionValue = options.selectedValue;
      options.decision.dropdownOpenStatus = 'skipped';
      options.decision.optionSelectStatus = 'skipped';
      options.decision.selectionVerified = false;
      const optionLocator = await executeSelectAction(input, options.parsedAction, locator, options.decision);
      options.decision.optionLocator = optionLocator;
      options.decision.optionValue = options.selectedValue;
      options.decision.dropdownOpenStatus = 'success';
      options.decision.optionSelectStatus = 'success';
      options.decision.selectionVerified = true;
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
  decision.dropdownOpenStatus = 'success';
  await input.page.waitForTimeout(300);

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
  if (getActionDecisionMode() === 'llm_first') {
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
  } else if (safeOptionCandidates.length === 1) {
    selectedOptionLocator = safeOptionCandidates[0].locator;
  } else {
    const deterministicOption = selectDeterministicSafeCandidate(safeOptionCandidates);
    if (deterministicOption) {
      selectedOptionLocator = deterministicOption.locator;
      decision.llmReason = appendReason(
        decision.llmReason,
        'Option selection used the highest-priority deterministic safe locator.'
      );
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
  decision.optionLocator = selectedOptionLocator;
  decision.optionValue = optionValue;
  decision.optionSelectStatus = 'success';
  decision.selectionVerified = true;
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

  const strongestSemanticCandidate = sorted.find(isStrongSemanticCandidate);
  if (strongestSemanticCandidate) {
    return strongestSemanticCandidate;
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

function selectStrongDeterministicCandidate(safeCandidates: LocatorCandidate[]): LocatorCandidate | null {
  const strongCandidates = safeCandidates.filter((candidate) => {
    const source = candidate.source.toLowerCase();
    return (
      candidate.selectorRisk !== 'high' &&
      !source.includes(':semantic') &&
      (source.includes('atomic-exact-target') || source.includes('placeholder') || source.includes('label')) &&
      ['getByTestId', 'getByRole', 'getByLabel', 'getByPlaceholder', 'getByText', 'css'].includes(candidate.locatorType)
    );
  });

  return selectDeterministicSafeCandidate(strongCandidates);
}

function isStrongSemanticCandidate(candidate: LocatorCandidate): boolean {
  return (
    candidate.priority <= 30 &&
    ['getByTestId', 'getByRole', 'getByLabel', 'getByPlaceholder', 'getByText', 'fieldControlByLabel'].includes(candidate.locatorType)
  );
}

function applyLLMMetadata(decision: ReconDecision, advisorDecision: LLMActionDecision): void {
  decision.llmRawResponsePreview = advisorDecision.rawResponsePreview;
  decision.llmParseError = advisorDecision.parseError ?? null;
  decision.llmRetryUsed = advisorDecision.retryUsed ?? false;
  decision.llmRetryStatus = advisorDecision.retryStatus ?? 'not_used';
  decision.llmPromptTokenEstimate = addOptionalNumber(
    decision.llmPromptTokenEstimate,
    advisorDecision.promptTokenEstimate
  );
  decision.llmResponseTokenEstimate = addOptionalNumber(
    decision.llmResponseTokenEstimate,
    advisorDecision.responseTokenEstimate
  );
  decision.llmTotalTokenEstimate = addOptionalNumber(
    decision.llmTotalTokenEstimate,
    advisorDecision.totalTokenEstimate
  );
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

function isSafeCandidateSelection(selectedLocator: string | null, safeCandidates: LocatorCandidate[]): boolean {
  return Boolean(selectedLocator && safeCandidates.some((candidate) => candidate.locator === selectedLocator));
}

function safeValidationResults(
  safeCandidates: LocatorCandidate[],
  validations: LocatorValidationResult[]
): LocatorValidationResult[] {
  const safeLocators = new Set(safeCandidates.map((candidate) => candidate.locator));
  return validations.filter((validation) => safeLocators.has(validation.locator) && validation.isSafe);
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

function disabledTargetValidationReason(
  candidates: LocatorCandidate[],
  validations: LocatorValidationResult[]
): { locator: string; reason: string } | null {
  if (candidates.length === 0) {
    return null;
  }

  const candidateLocators = new Set(candidates.map((candidate) => candidate.locator));
  const relevantValidations = validations.filter((validation) => candidateLocators.has(validation.locator));
  if (relevantValidations.length === 0) {
    return null;
  }

  const disabledValidation = relevantValidations.find((validation) =>
    /not enabled|disabled UI ancestor/i.test(validation.reason)
  );

  if (!disabledValidation) {
    return null;
  }

  const allMatchesAreDisabledOrUnsafe = relevantValidations.every((validation) => {
    if (validation.isSafe) {
      return false;
    }

    return /not enabled|disabled UI ancestor|strict mode risk|matched zero elements/i.test(validation.reason);
  });

  if (!allMatchesAreDisabledOrUnsafe) {
    return null;
  }

  return {
    locator: disabledValidation.locator,
    reason: `Target is present but disabled: ${disabledValidation.reason}`
  };
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

function addOptionalNumber(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return left + right;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isRuntimeOnlyPayloadKey(key: string): boolean {
  return /^(registration|invite|activation)\s+link$/i.test(key.trim());
}
