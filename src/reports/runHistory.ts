import fs from 'fs-extra';
import path from 'path';
import { resolveFromRoot } from '../utils/fileUtils';

export interface RunHistoryEntry {
  timestamp: string;
  scenarioId: string;
  status: 'passed' | 'failed' | 'unknown';
  error?: string;
  durationMs?: number;
}

export async function appendRunHistory(entry: RunHistoryEntry): Promise<void> {
  const historyFile = resolveFromRoot('run-history.json');
  let history: RunHistoryEntry[] = [];
  try {
    if (await fs.pathExists(historyFile)) {
      history = await fs.readJson(historyFile);
    }
  } catch (err) {
    // ignore
  }

  history.push(entry);
  // keep last 100 runs
  if (history.length > 100) {
    history = history.slice(history.length - 100);
  }

  await fs.ensureDir(path.dirname(historyFile));
  await fs.writeJson(historyFile, history, { spaces: 2 });
}

export async function getScenarioRunHistory(scenarioId: string): Promise<RunHistoryEntry[]> {
  const historyFile = resolveFromRoot('run-history.json');
  try {
    if (await fs.pathExists(historyFile)) {
      const history: RunHistoryEntry[] = await fs.readJson(historyFile);
      return history.filter(h => h.scenarioId === scenarioId);
    }
  } catch (err) {
    // ignore
  }
  return [];
}
