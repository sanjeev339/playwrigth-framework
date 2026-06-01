import type { PayloadIdentity } from '../scenario/payloadIdentityResolver';

export type ActionType = 'navigate' | 'click' | 'fill' | 'select' | 'verify' | 'wait' | 'row_action' | 'unknown';

export type DecisionActionType = Exclude<ActionType, 'unknown'> | 'skip' | 'error';

export type DecisionSource = 'deterministic' | 'llm' | 'none';

export type ActionStatus = 'success' | 'failed' | 'skipped';

export interface ParsedAction {
  rawStep: string;
  stepNo?: number;
  actionType: ActionType;
  target: string | null;
  value: string | null;
  payloadKey?: string | null;
  payloadIdentity?: PayloadIdentity | null;
  rowAction?: string | null;
}

export type StructuredLocator =
  | {
      method: 'getByRole';
      role: string;
      name?: string;
      exact?: boolean;
    }
  | {
      method: 'getByLabel' | 'getByPlaceholder' | 'getByText' | 'getByTestId';
      text: string;
      exact?: boolean;
    }
  | {
      method: 'css' | 'xpath';
      selector: string;
    }
  | {
      method: 'rowButtonByText';
      text: string;
      buttonIndex?: number;
    }
  | {
      method: 'fieldControlByLabel';
      label: string;
      controlSelector?: string;
    };

export interface LocatorCandidate {
  locator: string;
  locatorType: string;
  priority: number;
  source: string;
  selectorConfidenceScore?: number;
  selectorRisk?: 'low' | 'medium' | 'high';
  selectorConfidenceSignals?: string[];
  elementSummary?: Record<string, unknown>;
  structuredLocator: StructuredLocator;
}

export interface LocatorValidationResult {
  locator: string;
  count: number;
  isVisible?: boolean;
  isEnabled?: boolean;
  isSafe: boolean;
  reason: string;
}

export interface LLMActionDecision {
  actionType: DecisionActionType;
  target: string;
  value: string | null;
  selectedLocator: string | null;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  rawResponsePreview?: string;
  parseError?: string | null;
  retryUsed?: boolean;
  retryStatus?: 'success' | 'failed' | 'not_used';
}

export interface ReconDecision {
  scenarioId: string;
  stepNo?: number;
  rawStep: string;
  parsedAction: ParsedAction;
  deterministicCandidates: LocatorCandidate[];
  validatedCandidates: LocatorValidationResult[];
  decisionSource: DecisionSource;
  selectedLocator: string | null;
  selectedValue: string | null;
  llmReason?: string;
  confidence?: 'high' | 'medium' | 'low';
  selectorConfidenceScore?: number;
  selectorRisk?: 'low' | 'medium' | 'high';
  selectorConfidenceSignals?: string[];
  dropdownLocator?: string | null;
  optionLocator?: string | null;
  optionValue?: string | null;
  dropdownOpenStatus?: 'success' | 'failed' | 'skipped' | 'not_applicable';
  optionSelectStatus?: 'success' | 'failed' | 'skipped' | 'not_applicable';
  selectionVerified?: boolean;
  llmRawResponsePreview?: string;
  llmParseError?: string | null;
  llmRetryUsed?: boolean;
  llmRetryStatus?: 'success' | 'failed' | 'not_used';
  executed: boolean;
  actionStatus: ActionStatus;
  actionError?: string | null;
  timestamp: string;
}
