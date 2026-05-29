import path from 'node:path';
import type { ReconSnapshot } from '../types';
import type { LocatorCandidate, ReconDecision } from './reconDecisionTypes';
import { listFiles, readJsonFile, resolveFromRoot, toSafeFileName, writeJsonFile } from '../utils/fileUtils';

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
  snapshotFile: string;
  dropdownSnapshotFile?: string | null;
  postActionUrl?: string | null;
  postActionLandmarkLocator?: string | null;
}

interface SnapshotWithFile {
  file: string;
  prefix: number;
  snapshot: ReconSnapshot;
}

export async function extractReconActions(scenarioId: string): Promise<ReconAction[]> {
  const safeScenarioId = toSafeFileName(scenarioId);
  const scenarioReconDir = resolveFromRoot('recon', safeScenarioId);
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

  const actionsByStep = new Map<string, ReconAction>();

  for (const entry of sortedSnapshots) {
    const decision = entry.snapshot.decision;
    if (!decision || isDropdownOpenSnapshot(entry.snapshot)) {
      continue;
    }

    if (!isAfterStepSnapshot(entry.snapshot) && decision.stepNo !== undefined) {
      continue;
    }

    const action = toReconAction(decision, entry, dropdownSnapshotsByStep.get(decision.stepNo ?? -1));
    const key = `${action.stepNo ?? 'na'}:${action.rawStep}`;
    actionsByStep.set(key, action);
  }

  const actions = [...actionsByStep.values()].sort(
    (left, right) => (left.stepNo ?? Number.MAX_SAFE_INTEGER) - (right.stepNo ?? Number.MAX_SAFE_INTEGER)
  );

  const outputPath = resolveFromRoot('recon-summary', `${safeScenarioId}.actions.json`);
  if (actions.length > 0) {
    await writeJsonFile(outputPath, actions);
  }

  return actions;
}

export async function loadReconActions(scenarioId: string): Promise<ReconAction[]> {
  const extracted = await extractReconActions(scenarioId);
  if (extracted.length > 0) {
    return extracted;
  }

  const summaryPath = resolveFromRoot('recon-summary', `${toSafeFileName(scenarioId)}.actions.json`);
  try {
    const summary = await readJsonFile<ReconAction[]>(summaryPath);
    if (summary.length > 0) {
      return summary;
    }
  } catch {
    // fall through to fixture
  }

  const fixturePath = resolveFromRoot('tests/fixtures/recon-actions', `${toSafeFileName(scenarioId)}.actions.json`);
  return readJsonFile<ReconAction[]>(fixturePath);
}

function toReconAction(
  decision: ReconDecision,
  entry: SnapshotWithFile,
  dropdownSnapshot?: SnapshotWithFile
): ReconAction {
  const selectedLocatorParts = splitSelectLocator(decision.selectedLocator);
  const optionValue = decision.parsedAction.actionType === 'select' ? decision.selectedValue ?? decision.parsedAction.value : null;
  const inferredOptionLocator =
    decision.parsedAction.actionType === 'select'
      ? selectedLocatorParts.optionLocator ?? findOptionLocator(decision.deterministicCandidates, optionValue)
      : null;
  const dropdownLocator =
    decision.parsedAction.actionType === 'select'
      ? selectedLocatorParts.dropdownLocator ?? dropdownSnapshot?.snapshot.decision?.selectedLocator ?? decision.selectedLocator
      : null;

  return {
    scenarioId: decision.scenarioId,
    stepNo: decision.stepNo,
    rawStep: decision.rawStep,
    actionType: decision.parsedAction.actionType,
    target: decision.parsedAction.target,
    value: decision.parsedAction.value,
    selectedLocator: decision.selectedLocator,
    selectedValue: decision.selectedValue,
    actionStatus: decision.actionStatus,
    actionError: decision.actionError,
    decisionSource: decision.decisionSource,
    dropdownLocator,
    optionLocator: inferredOptionLocator,
    optionValue,
    optionSelectStatus: optionStatus(decision, inferredOptionLocator),
    selectionVerified: decision.parsedAction.actionType === 'select' && decision.actionStatus === 'success',
    snapshotFile: path.relative(process.cwd(), entry.file),
    dropdownSnapshotFile: dropdownSnapshot ? path.relative(process.cwd(), dropdownSnapshot.file) : null,
    postActionUrl: entry.snapshot.url ?? null,
    postActionLandmarkLocator: extractPostActionLandmark(entry.snapshot)
  };
}

function extractPostActionLandmark(snapshot: ReconSnapshot): string | null {
  const headings = snapshot.elements.filter(
    (element) =>
      element.isVisible &&
      (element.role === 'heading' || /^h[1-3]$/i.test(element.tag)) &&
      Boolean(element.text?.trim())
  );

  const withSuggested = headings.find((element) => element.suggestedLocator);
  if (withSuggested?.suggestedLocator) {
    return withSuggested.suggestedLocator;
  }

  const primary =
    headings.find((element) => element.tag === 'h1') ??
    headings.find((element) => element.tag === 'h2') ??
    headings[0];

  if (!primary?.text) {
    return null;
  }

  const escaped = primary.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '\\/');
  return `page.getByRole('heading', { name: /${escaped}/i })`;
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

function optionStatus(decision: ReconDecision, optionLocator: string | null): 'success' | 'failed' | 'skipped' | 'not_applicable' {
  if (decision.parsedAction.actionType !== 'select') {
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
