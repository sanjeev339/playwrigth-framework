import path from 'node:path';
import fs from 'fs-extra';
import { resolveFromRoot, listFiles, readJsonFile, writeJsonFile, toSafeFileName } from '../utils/fileUtils';
import type { ReconAction } from './reconActionExtractor';
import { logger } from '../utils/logger';

export interface DriftDiff {
  stepNo?: number;
  rawStep: string;
  type: 'locator_drift' | 'url_drift' | 'confidence_drift' | 'step_added' | 'step_removed' | 'step_modified';
  description: string;
  prevValue?: string | number;
  currValue?: string | number;
}

export interface DriftAnalysisResult {
  hasDrift: boolean;
  diffs: DriftDiff[];
  confidenceTrend: {
    prevAverage: number;
    currAverage: number;
    deteriorated: boolean;
  };
}

export interface ArchivedRun {
  folderPath: string;
  type: 'run' | 'deployment';
  timestamp: string;
}

/**
 * Archives the current recon run to recon-history/[scenarioId]/[run-type]-[timestamp]/
 */
export async function archiveReconRun(scenarioId: string): Promise<string> {
  const safeScenarioId = toSafeFileName(scenarioId);
  const reconDir = resolveFromRoot('recon', safeScenarioId);
  const summaryPath = resolveFromRoot('recon-summary', `${safeScenarioId}.actions.json`);
  const historyBaseDir = resolveFromRoot('recon-history', safeScenarioId);

  if (!(await fs.pathExists(reconDir))) {
    logger.warn(`No recon files found to archive for ${scenarioId}`);
    return '';
  }

  const isDeployment = process.env.DEPLOYMENT_BOUNDARY === 'true';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runFolderName = `${isDeployment ? 'deployment' : 'run'}-${timestamp}`;
  const archiveDir = path.join(historyBaseDir, runFolderName);

  await fs.ensureDir(archiveDir);

  // Copy snapshots
  const snapshotsDest = path.join(archiveDir, 'snapshots');
  await fs.copy(reconDir, snapshotsDest);

  // Copy summary actions
  if (await fs.pathExists(summaryPath)) {
    await fs.copy(summaryPath, path.join(archiveDir, 'actions.json'));
  }

  logger.info(`Archived recon run for ${scenarioId} to ${archiveDir}`);

  // Enforce rolling retention of last 10 non-deployment runs
  await enforceRollingRetention(historyBaseDir);

  return archiveDir;
}

/**
 * Lists all archived runs for a scenario, sorted by timestamp descending
 */
export async function getArchivedRuns(scenarioId: string): Promise<ArchivedRun[]> {
  const safeScenarioId = toSafeFileName(scenarioId);
  const historyBaseDir = resolveFromRoot('recon-history', safeScenarioId);

  if (!(await fs.pathExists(historyBaseDir))) {
    return [];
  }

  const dirs = await fs.readdir(historyBaseDir);
  const runs: ArchivedRun[] = [];

  for (const dir of dirs) {
    const fullPath = path.join(historyBaseDir, dir);
    const stat = await fs.stat(fullPath);
    if (!stat.isDirectory()) {
      continue;
    }

    const match = dir.match(/^(run|deployment)-(.*)$/);
    if (match) {
      runs.push({
        folderPath: fullPath,
        type: match[1] as 'run' | 'deployment',
        timestamp: match[2]
      });
    }
  }

  // Sort descending by timestamp
  return runs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/**
 * Enforces rolling retention of maximum 10 non-deployment runs
 */
async function enforceRollingRetention(historyBaseDir: string): Promise<void> {
  const dirs = await fs.readdir(historyBaseDir);
  const runs: { folderPath: string; timestamp: string }[] = [];

  for (const dir of dirs) {
    const fullPath = path.join(historyBaseDir, dir);
    const stat = await fs.stat(fullPath);
    if (!stat.isDirectory()) {
      continue;
    }

    const match = dir.match(/^run-(.*)$/);
    if (match) {
      runs.push({
        folderPath: fullPath,
        timestamp: match[1]
      });
    }
  }

  // Sort ascending by timestamp (oldest first)
  runs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (runs.length > 10) {
    const toDeleteCount = runs.length - 10;
    for (let i = 0; i < toDeleteCount; i++) {
      await fs.remove(runs[i].folderPath);
      logger.info(`Pruned old archived recon run: ${runs[i].folderPath}`);
    }
  }
}

/**
 * Compares two recon summaries to detect locator and URL drift
 */
export function diffReconSummaries(prev: ReconAction[], curr: ReconAction[]): DriftAnalysisResult {
  const diffs: DriftDiff[] = [];

  const prevByStepNo = new Map<number, ReconAction>();
  const prevByInstruction = new Map<string, ReconAction>();

  for (const action of prev) {
    if (action.stepNo !== undefined) {
      prevByStepNo.set(action.stepNo, action);
    }
    prevByInstruction.set(action.rawStep, action);
  }

  const matchedPrevSteps = new Set<string>();

  for (const currAction of curr) {
    // Attempt matching by stepNo first, then instruction
    let prevAction = currAction.stepNo !== undefined ? prevByStepNo.get(currAction.stepNo) : undefined;
    if (!prevAction) {
      prevAction = prevByInstruction.get(currAction.rawStep);
    }

    if (!prevAction) {
      diffs.push({
        stepNo: currAction.stepNo,
        rawStep: currAction.rawStep,
        type: 'step_added',
        description: `Step "${currAction.rawStep}" was newly added.`
      });
      continue;
    }

    matchedPrevSteps.add(`${prevAction.stepNo}:${prevAction.rawStep}`);

    // Check step modifications
    if (prevAction.rawStep !== currAction.rawStep) {
      diffs.push({
        stepNo: currAction.stepNo,
        rawStep: currAction.rawStep,
        type: 'step_modified',
        description: `Step instruction changed from "${prevAction.rawStep}" to "${currAction.rawStep}".`,
        prevValue: prevAction.rawStep,
        currValue: currAction.rawStep
      });
    }

    // Check locator drift
    if (prevAction.selectedLocator !== currAction.selectedLocator) {
      diffs.push({
        stepNo: currAction.stepNo,
        rawStep: currAction.rawStep,
        type: 'locator_drift',
        description: `Locator drifted from \`${prevAction.selectedLocator}\` to \`${currAction.selectedLocator}\`.`,
        prevValue: prevAction.selectedLocator ?? undefined,
        currValue: currAction.selectedLocator ?? undefined
      });
    }

    // Check URL drift
    if (prevAction.postActionUrl !== currAction.postActionUrl) {
      diffs.push({
        stepNo: currAction.stepNo,
        rawStep: currAction.rawStep,
        type: 'url_drift',
        description: `URL post-action drifted from \`${prevAction.postActionUrl}\` to \`${currAction.postActionUrl}\`.`,
        prevValue: prevAction.postActionUrl ?? undefined,
        currValue: currAction.postActionUrl ?? undefined
      });
    }

    // Check confidence deterioration
    const prevConf = prevAction.selectorConfidenceScore ?? 1.0;
    const currConf = currAction.selectorConfidenceScore ?? 1.0;
    if (currConf < prevConf) {
      diffs.push({
        stepNo: currAction.stepNo,
        rawStep: currAction.rawStep,
        type: 'confidence_drift',
        description: `Confidence score deteriorated from ${prevConf} to ${currConf}.`,
        prevValue: prevConf,
        currValue: currConf
      });
    }
  }

  // Find removed steps
  for (const prevAction of prev) {
    const key = `${prevAction.stepNo}:${prevAction.rawStep}`;
    if (!matchedPrevSteps.has(key)) {
      diffs.push({
        stepNo: prevAction.stepNo,
        rawStep: prevAction.rawStep,
        type: 'step_removed',
        description: `Step "${prevAction.rawStep}" was removed.`
      });
    }
  }

  // Calculate average confidence scores
  const prevConfidences = prev.map(a => a.selectorConfidenceScore).filter((c): c is number => c !== undefined);
  const currConfidences = curr.map(a => a.selectorConfidenceScore).filter((c): c is number => c !== undefined);

  const prevAverage = prevConfidences.length > 0 ? prevConfidences.reduce((sum, c) => sum + c, 0) / prevConfidences.length : 1.0;
  const currAverage = currConfidences.length > 0 ? currConfidences.reduce((sum, c) => sum + c, 0) / currConfidences.length : 1.0;

  return {
    hasDrift: diffs.length > 0,
    diffs,
    confidenceTrend: {
      prevAverage,
      currAverage,
      deteriorated: currAverage < prevAverage
    }
  };
}

/**
 * Finds the latest historical run for a scenario and diffs it against current
 */
export async function analyzeScenarioDrift(scenarioId: string, currentActions: ReconAction[]): Promise<DriftAnalysisResult | null> {
  const archived = await getArchivedRuns(scenarioId);
  if (archived.length === 0) {
    return null;
  }

  const latestRun = archived[0]; // first item is newest
  const actionsJsonPath = path.join(latestRun.folderPath, 'actions.json');
  if (!(await fs.pathExists(actionsJsonPath))) {
    return null;
  }

  try {
    const prevActions = await readJsonFile<ReconAction[]>(actionsJsonPath);
    return diffReconSummaries(prevActions, currentActions);
  } catch (err) {
    logger.error(`Failed to read historical actions from ${actionsJsonPath}`, err);
    return null;
  }
}
