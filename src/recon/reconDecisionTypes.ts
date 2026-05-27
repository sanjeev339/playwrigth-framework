export type ActionType = 'navigate' | 'click' | 'fill' | 'select' | 'verify' | 'wait' | 'unknown';

export type DecisionActionType = Exclude<ActionType, 'unknown'> | 'skip' | 'error';

export type DecisionSource = 'deterministic' | 'llm' | 'none';

export type ActionStatus = 'success' | 'failed' | 'skipped';

export interface ParsedAction {
  rawStep: string;
  stepNo?: number;
  actionType: ActionType;
  target: string | null;
  value: string | null;
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
    };

export interface LocatorCandidate {
  locator: string;
  locatorType: string;
  priority: number;
  source: string;
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
  llmRawResponsePreview?: string;
  llmParseError?: string | null;
  llmRetryUsed?: boolean;
  llmRetryStatus?: 'success' | 'failed' | 'not_used';
  executed: boolean;
  actionStatus: ActionStatus;
  actionError?: string | null;
  timestamp: string;
}
