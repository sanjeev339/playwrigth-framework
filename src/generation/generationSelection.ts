import path from 'node:path';
import fs from 'fs-extra';
import type { GenerationReport } from '../types';
import { listFiles, readJsonFile, toSafeFileName } from '../utils/fileUtils';

export interface LatestGenerationSelection {
  report: GenerationReport | null;
  generatedFiles: string[];
  successfulScenarioIds: string[];
}

export async function getLatestGenerationSelection(options: {
  generationReportPath: string;
  generatedDir: string;
}): Promise<LatestGenerationSelection> {
  if (!(await fs.pathExists(options.generationReportPath))) {
    const generatedFiles = await listFiles(options.generatedDir, '.ts');
    return {
      report: null,
      generatedFiles,
      successfulScenarioIds: generatedFiles.map(scenarioIdFromGeneratedFile)
    };
  }

  const report = await readJsonFile<GenerationReport>(options.generationReportPath);
  const successfulScenarios = report.scenarios.filter(
    (scenario) => scenario.status === 'generated' && Boolean(scenario.generated_file)
  );
  const generatedFiles = (
    await Promise.all(
      successfulScenarios.map(async (scenario) => {
        const generatedFile = path.resolve(process.cwd(), scenario.generated_file!);
        if (!isWithinDir(generatedFile, options.generatedDir) || !(await fs.pathExists(generatedFile))) {
          return null;
        }
        return generatedFile;
      })
    )
  ).filter((file): file is string => Boolean(file));

  return {
    report,
    generatedFiles,
    successfulScenarioIds: successfulScenarios.map((scenario) => toSafeFileName(scenario.scenario_id))
  };
}

function scenarioIdFromGeneratedFile(file: string): string {
  return path.basename(file).replace(/\.spec\.ts$/, '');
}

function isWithinDir(file: string, directory: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(file));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
