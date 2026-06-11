import path from 'node:path';
import { getFrameworkPaths } from '../config/env';
import type { ReconSnapshot } from '../types';
import type { LocatorCandidate, ReconDecision, ParsedAction, ActionType } from './reconDecisionTypes';
import { listFiles, readJsonFile, toSafeFileName, writeJsonFile } from '../utils/fileUtils';
import { parseAction } from './actionParser';

export interface ReconAction {
  scenarioId: string;
  stepNo?: number;
  rawStep: string;
  actionType: ReconDecision['parsedAction']['actionType'];
  target: string | null;
  value: string | null;
  selectedLocator: string | null;
  selectedValue: string | null;
  actionStatus: ReconDecision['actionStatus'];
  actionError?: string | null;
  decisionSource: ReconDecision['decisionSource'];
  dropdownLocator?: string | null;
  optionLocator?: string | null;
  optionValue?: string | null;
  optionSelectStatus?: 'success' | 'failed' | 'skipped' | 'not_applicable';
  selectionVerified?: boolean;
  payloadIdentity?: ReconDecision['parsedAction']['payloadIdentity'];
  rowLocator?: string | null;
  rowActionLocator?: string | null;
  snapshotFile: string;
  dropdownSnapshotFile?: string | null;
}

interface SnapshotWithFile {
  file: string;
  prefix: number;
  snapshot: ReconSnapshot;
}

export async function extractReconActions(scenarioId: string, reconRootDir = getFrameworkPaths().dynamicReconDir): Promise<ReconAction[]> {
  const safeScenarioId = toSafeFileName(scenarioId);
  const scenarioReconDir = path.join(reconRootDir, safeScenarioId);
  const snapshotFiles = await listFiles(scenarioReconDir, '.json');
  const snapshots = await Promise.all(
    snapshotFiles.map(async (file) => ({
      file,
      prefix: numericPrefix(file),
      snapshot: await readJsonFile<ReconSnapshot>(file)
    }))
  );

  const sortedSnapshots = snapshots.sort((left, right) => left.prefix - right.prefix || left.file.localeCompare(right.file));
  const dropdownSnapshotsByStep = new Map<number, SnapshotWithFile>();

  for (const entry of sortedSnapshots) {
    const decision = entry.snapshot.decision;
    if (!decision || decision.stepNo === undefined) {
      continue;
    }

    if (isDropdownOpenSnapshot(entry.snapshot)) {
      dropdownSnapshotsByStep.set(decision.stepNo, entry);
    }
  }

  let payload: Record<string, unknown> = {};
  try {
    const scenarioPath = path.join(getFrameworkPaths().scenarioDir, `${safeScenarioId}.json`);
    const scenario = await readJsonFile<any>(scenarioPath);
    payload = scenario.payload ?? {};
  } catch {}

  const actionsByStep = new Map<string, ReconAction>();

  for (const entry of sortedSnapshots) {
    const decision = entry.snapshot.decision;
    if (!decision || isDropdownOpenSnapshot(entry.snapshot)) {
      continue;
    }

    if (!isAfterStepSnapshot(entry.snapshot) && decision.stepNo !== undefined) {
      continue;
    }

    const action = toReconAction(decision, entry, payload, dropdownSnapshotsByStep.get(decision.stepNo ?? -1));
    const key = `${action.stepNo ?? 'na'}:${action.rawStep}`;
    actionsByStep.set(key, action);
  }

  const actions = [...actionsByStep.values()].sort(
    (left, right) => (left.stepNo ?? Number.MAX_SAFE_INTEGER) - (right.stepNo ?? Number.MAX_SAFE_INTEGER)
  );

  const outputPath = path.join(getFrameworkPaths().reconSummaryDir, `${safeScenarioId}.actions.json`);
  await writeJsonFile(outputPath, actions);
  return actions;
}

function toReconAction(
  decision: ReconDecision,
  entry: SnapshotWithFile,
  payload: Record<string, unknown>,
  dropdownSnapshot?: SnapshotWithFile
): ReconAction {
  const parsedAction = parseAction(decision.rawStep, payload);
  const selectedLocatorParts = splitSelectLocator(decision.selectedLocator);
  const optionValue = parsedAction.actionType === 'select' ? decision.selectedValue ?? parsedAction.value : null;
  const inferredOptionLocator =
    parsedAction.actionType === 'select'
      ? decision.optionLocator ?? selectedLocatorParts.optionLocator ?? findOptionLocator(decision.deterministicCandidates, optionValue)
      : null;
  const dropdownLocator =
    parsedAction.actionType === 'select'
      ? decision.dropdownLocator ?? selectedLocatorParts.dropdownLocator ?? dropdownSnapshot?.snapshot.decision?.selectedLocator ?? decision.selectedLocator
      : null;
  const rowLocator = rowLocatorForDecision(decision, parsedAction);
  const rowActionLocator = parsedAction.actionType === 'row_action' ? decision.selectedLocator : null;

  return {
    scenarioId: decision.scenarioId,
    stepNo: decision.stepNo,
    rawStep: decision.rawStep,
    actionType: parsedAction.actionType,
    target: parsedAction.target,
    value: parsedAction.value,
    selectedLocator: decision.selectedLocator,
    selectedValue: decision.selectedValue,
    actionStatus: decision.actionStatus,
    actionError: decision.actionError,
    decisionSource: decision.decisionSource,
    dropdownLocator,
    optionLocator: inferredOptionLocator,
    optionValue: decision.optionValue ?? optionValue,
    optionSelectStatus: decision.optionSelectStatus ?? optionStatus(decision, inferredOptionLocator, parsedAction.actionType),
    selectionVerified: decision.selectionVerified ?? (parsedAction.actionType === 'select' && decision.actionStatus === 'success'),
    payloadIdentity: parsedAction.payloadIdentity,
    rowLocator,
    rowActionLocator,
    snapshotFile: path.relative(process.cwd(), entry.file),
    dropdownSnapshotFile: dropdownSnapshot ? path.relative(process.cwd(), dropdownSnapshot.file) : null
  };
}

function splitSelectLocator(selectedLocator: string | null): { dropdownLocator: string | null; optionLocator: string | null } {
  if (!selectedLocator) {
    return { dropdownLocator: null, optionLocator: null };
  }

  const [dropdownLocator, ...optionParts] = selectedLocator.split(' -> ');
  return {
    dropdownLocator: dropdownLocator || null,
    optionLocator: optionParts.length ? optionParts.join(' -> ') : null
  };
}

function findOptionLocator(candidates: LocatorCandidate[], optionValue: string | null): string | null {
  if (!optionValue) {
    return null;
  }

  const normalizedValue = normalize(optionValue);
  const matches = candidates.filter((candidate) => {
    const elementText = normalize(String(candidate.elementSummary?.text ?? ''));
    const locator = normalize(candidate.locator);
    return elementText === normalizedValue || locator.includes(normalizedValue);
  });

  const roleOption = matches.find((candidate) => candidate.locatorType === 'getByRole' && /option/i.test(candidate.locator));
  const textOption = matches.find((candidate) => candidate.locatorType === 'getByText');
  return (roleOption ?? textOption ?? matches.sort((left, right) => left.priority - right.priority)[0])?.locator ?? null;
}

function optionStatus(decision: ReconDecision, optionLocator: string | null, parsedActionType: ActionType): 'success' | 'failed' | 'skipped' | 'not_applicable' {
  if (parsedActionType !== 'select') {
    return 'not_applicable';
  }
  if (decision.actionStatus === 'success' && optionLocator) {
    return 'success';
  }
  if (decision.actionStatus === 'failed') {
    return 'failed';
  }
  return 'skipped';
}

function rowLocatorForDecision(decision: ReconDecision, parsedAction: ParsedAction): string | null {
  const identityValue = parsedAction.payloadIdentity?.identityValue;
  if (!identityValue || parsedAction.actionType !== 'row_action') {
    return null;
  }

  return `page.getByRole("row", { name: /${escapeRegex(identityValue)}/i })`;
}

function isDropdownOpenSnapshot(snapshot: ReconSnapshot): boolean {
  return /dropdown-open/i.test(snapshot.state);
}

function isAfterStepSnapshot(snapshot: ReconSnapshot): boolean {
  return /step-\d+-after/i.test(snapshot.state);
}

function numericPrefix(filePath: string): number {
  const match = path.basename(filePath).match(/^(\d+)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '\\/');
}
