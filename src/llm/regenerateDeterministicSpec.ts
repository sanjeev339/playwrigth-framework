import path from 'node:path';
import type { Scenario } from '../types';
import { loadReconActions, type ReconAction } from '../recon/reconActionExtractor';
import { buildDeterministicReconTest } from './generatorPromptBuilder';
import { validateGeneratedReconTest } from './validateGeneratedReconTest';
import { listFiles, readJsonFile, resolveFromRoot, toSafeFileName, writeTextFile } from '../utils/fileUtils';
import { logger } from '../utils/logger';

export async function regenerateDeterministicSpec(options: {
  scenarioIds?: string[];
  scenarioDir?: string;
  outputDir?: string;
} = {}): Promise<string[]> {
  const scenarioDir = options.scenarioDir ?? process.env.SCENARIOS_DIR ?? resolveFromRoot('scenarios');
  const outputDir = options.outputDir ?? resolveFromRoot('tests', 'generated');
  const scenarioIds = options.scenarioIds?.map((id) => id.trim()).filter(Boolean);

  const scenarioFiles = await resolveScenarioFiles(scenarioDir, scenarioIds);
  if (scenarioFiles.length === 0) {
    throw new Error(
      scenarioIds?.length
        ? `No scenario files matched: ${scenarioIds.join(', ')}`
        : `No scenario files found in ${scenarioDir}. Run npm run build:scenarios first.`
    );
  }

  const writtenFiles: string[] = [];

  for (const scenarioFile of scenarioFiles) {
    const scenario = await readJsonFile<Scenario>(scenarioFile);
    const reconActions = await loadReconActions(scenario.scenario_id);

    if (reconActions.length === 0) {
      throw new Error(
        `No recon actions for ${scenario.scenario_id}. Run npm run recon first (or ensure recon-summary/${toSafeFileName(scenario.scenario_id)}.actions.json exists).`
      );
    }

    const code = await buildDeterministicReconTest(scenario, reconActions);
    validateGeneratedReconTest(code, scenario, reconActions);

    const outputPath = path.join(outputDir, `${toSafeFileName(scenario.scenario_id)}.spec.ts`);
    await writeTextFile(outputPath, code);
    writtenFiles.push(outputPath);
    logger.info(`Regenerated deterministic spec for ${scenario.scenario_id} -> ${outputPath}`);
  }

  return writtenFiles;
}

async function resolveScenarioFiles(scenarioDir: string, scenarioIds?: string[]): Promise<string[]> {
  const allFiles = await listFiles(scenarioDir, '.json');

  if (!scenarioIds?.length) {
    return allFiles;
  }

  const wanted = new Set(scenarioIds.map((id) => toSafeFileName(id)));
  const matched = allFiles.filter((file) => wanted.has(path.basename(file, '.json')));

  const missing = [...wanted].filter((safeId) => !matched.some((file) => path.basename(file, '.json') === safeId));
  if (missing.length > 0) {
    throw new Error(`Scenario not found in ${scenarioDir}: ${missing.join(', ')}`);
  }

  return matched;
}
