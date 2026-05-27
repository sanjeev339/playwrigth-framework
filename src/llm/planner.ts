import path from 'node:path';
import type { Scenario } from '../types';
import { listFiles, readJsonFile, resolveFromRoot, toSafeFileName, writeTextFile } from '../utils/fileUtils';
import { logger } from '../utils/logger';
import { callLLM } from './llmClient';

export async function generatePlans(options: {
  scenarioDir?: string;
  outputDir?: string;
} = {}): Promise<string[]> {
  const scenarioDir = options.scenarioDir ?? resolveFromRoot('scenarios');
  const outputDir = options.outputDir ?? resolveFromRoot('specs');
  const scenarioFiles = await listFiles(scenarioDir, '.json');
  const writtenFiles: string[] = [];

  if (scenarioFiles.length === 0) {
    throw new Error(`No scenario files found in ${scenarioDir}. Run npm run build:scenarios first.`);
  }

  logger.info(`Planning ${scenarioFiles.length} scenario(s) using LLM provider from env.`);

  for (const scenarioFile of scenarioFiles) {
    const scenario = await readJsonFile<Scenario>(scenarioFile);
    logger.info(`Generating plan for ${scenario.scenario_id} (${path.basename(scenarioFile)})...`);
    const prompt = buildPlannerPrompt(scenario);
    const plan = await callLLM(prompt);
    const outputPath = path.join(outputDir, `${toSafeFileName(scenario.scenario_id)}.md`);
    await writeTextFile(outputPath, normalizeMarkdown(plan));
    writtenFiles.push(outputPath);
    logger.info(`Wrote test plan for ${scenario.scenario_id} -> ${outputPath}`);
  }

  return writtenFiles;
}

function buildPlannerPrompt(scenario: Scenario): string {
  return [
    'Create a production-quality Playwright test plan in Markdown for this scenario.',
    '',
    'Rules:',
    '- Output Markdown only.',
    '- Use environment credentials for login.',
    '- Do not invent test data.',
    '- Do not hardcode credentials.',
    '- Include preconditions.',
    '- Include step-by-step business flow.',
    '- Include assertions.',
    '- Separate mandatory outcomes from optional UI: use explicit wording such as "Must:" for URL, page title/heading, and data visible in lists/forms; use "Optional (if visible):" for success toasts, snackbars, or brief banners that may auto-dismiss.',
    '- Include notes for dynamic UI states that need recon.',
    '',
    'Scenario JSON:',
    JSON.stringify(scenario, null, 2)
  ].join('\n');
}

function normalizeMarkdown(value: string): string {
  return value.replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/i, '').trimEnd() + '\n';
}

if (require.main === module) {
  generatePlans()
    .then((files) => {
      logger.info(`Generated ${files.length} Markdown plan(s).`);
    })
    .catch((error) => {
      logger.error('Planning failed.', error);
      process.exitCode = 1;
    });
}
