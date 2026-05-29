import type { ReconDecision, StructuredLocator } from './recon/reconDecisionTypes';

export interface TestFlowRow {
  scenario_id: string;
  module?: string;
  action?: string;
  step_no?: number;
  instruction: string;
  expected_result?: string;
}

export interface TestDataRecord {
  scenario_id: string;
  execution_order?: number;
  data_strategy?: string;
  edge_case_type?: string | null;
  depends_on?: string[];
  payload: Record<string, unknown>;
}

export interface ScenarioStep {
  step_no?: number;
  instruction: string;
  raw_instruction?: string;
  expected_result?: string;
  normalization_strategy?: string;
  normalization_context_from_previous?: boolean;
}

export interface Scenario {
  scenario_id: string;
  module?: string;
  action?: string;
  raw_steps?: ScenarioStep[];
  steps: ScenarioStep[];
  expected_results: string[];
  payload: Record<string, unknown>;
  metadata: {
    execution_order?: number;
    data_strategy?: string;
    edge_case_type?: string | null;
    depends_on?: string[];
    created_at: string;
    source_excel: string;
    source_json: string;
  };
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DomElementSnapshot {
  index: number;
  tag: string;
  type?: string;
  id?: string;
  name?: string;
  className?: string;
  text?: string;
  role?: string;
  ariaLabel?: string;
  /** From DOM `aria-live` — helps classify transient announcements. */
  ariaLive?: string;
  label?: string;
  placeholder?: string;
  title?: string;
  value?: string;
  dataTestId?: string;
  dataTest?: string;
  dataCy?: string;
  dataQa?: string;
  href?: string;
  isVisible: boolean;
  isEnabled?: boolean;
  isLikelyClickable?: boolean;
  boundingBox?: BoundingBox;
  cssCandidate?: string;
  xpathCandidate?: string;
  suggestedLocator?: string;
  locatorPriority?: string[];
  structuredLocatorPriority?: StructuredLocator[];
  /**
   * Deterministic structural confidence estimate (0..1) for the top-ranked locator.
   * This is not a correctness probability.
   */
  selectorConfidenceScore?: number;
  selectorRisk?: 'low' | 'medium' | 'high';
  selectorConfidenceSignals?: string[];
  /** Heuristic: ephemeral UI (toasts) vs stable — set during recon enrichment. */
  uiStability?: 'transient' | 'stable' | 'unknown';
}

export interface SnapshotStabilizationTelemetry {
  durationMs: number;
  mutationQuietWindowMs: number;
  timedOut: boolean;
}

export interface AccessibilityNode {
  role?: string;
  name?: string;
  value?: string | number;
  checked?: boolean | 'mixed';
  selected?: boolean;
  children?: AccessibilityNode[];
}

export interface ReconSnapshot {
  scenario_id: string;
  state: string;
  url: string;
  timestamp: string;
  action_before_snapshot?: string;
  decision?: ReconDecision | null;
  action_error: string | null;
  snapshotSessionId?: string;
  snapshotSequence?: number;
  stabilization?: SnapshotStabilizationTelemetry;
  elements: DomElementSnapshot[];
  accessibility: AccessibilityNode | Record<string, never>;
}

export interface LocatorValidationWarning {
  file: string;
  severity: 'low' | 'medium' | 'high';
  rule: string;
  message: string;
  locator?: string;
}

export interface LocatorValidationReport {
  generated_at: string;
  files: Array<{
    file: string;
    locators: string[];
    warnings: LocatorValidationWarning[];
  }>;
  warnings: LocatorValidationWarning[];
}

export interface PlaywrightRunResult {
  command: string;
  status: 'passed' | 'failed';
  exitCode: number | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  stdout: string;
  stderr: string;
  failedTestFiles: string[];
}
