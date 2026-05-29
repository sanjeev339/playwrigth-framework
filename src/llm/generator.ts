import path from 'node:path';
import type { ReconSnapshot, Scenario } from '../types';
import { inferUiStability } from '../recon/locatorCandidateBuilder';
import {
  listFiles,
  readJsonFile,
  readTextFile,
  resolveFromRoot,
  toSafeFileName,
  truncate,
  writeTextFile
} from '../utils/fileUtils';
import { logger } from '../utils/logger';
import { normalizeNestedTestImports } from '../utils/specImportPaths';
import { normalizeGeneratedWebsiteUrlUsage, websiteUrlPromptRules } from '../utils/websiteUrl';
import { requireEnvValue } from '../config/env';
import { callLLM } from './llmClient';

export async function generateTests(options: {
  scenarioDir?: string;
  specDir?: string;
  reconDir?: string;
  outputDir?: string;
} = {}): Promise<string[]> {
  const scenarioDir = options.scenarioDir ?? resolveFromRoot('scenarios');
  const specDir = options.specDir ?? resolveFromRoot('specs');
  const reconDir = options.reconDir ?? resolveFromRoot('recon');
  const outputDir = options.outputDir ?? resolveFromRoot('tests', 'generated');
  const scenarioFiles = await listFiles(scenarioDir, '.json');
  const writtenFiles: string[] = [];

  if (scenarioFiles.length === 0) {
    throw new Error(`No scenario files found in ${scenarioDir}. Run npm run build:scenarios first.`);
  }

  logger.info(`Generating tests for ${scenarioFiles.length} scenario(s) using LLM provider from env.`);

  for (const scenarioFile of scenarioFiles) {
    const scenario = await readJsonFile<Scenario>(scenarioFile);
    const safeScenarioId = toSafeFileName(scenario.scenario_id);
    const specPath = path.join(specDir, `${safeScenarioId}.md`);
    const reconPath = path.join(reconDir, safeScenarioId);
    logger.info(`Generating test for ${scenario.scenario_id} (spec: ${path.basename(specPath)})...`);
    const plan = await readTextFile(specPath);
    const snapshots = await readReconSnapshots(reconPath);
    logger.info(`Loaded ${snapshots.length} recon snapshot(s) for ${scenario.scenario_id}.`);
    const prompt = buildGeneratorPrompt(scenario, plan, snapshots);
    const generated = await callLLM(prompt);
    const code = normalizeGeneratedWebsiteUrlUsage(normalizeNestedTestImports(stripCodeFence(generated)));
    const outputPath = path.join(outputDir, `${safeScenarioId}.spec.ts`);
    await writeTextFile(outputPath, code);
    writtenFiles.push(outputPath);
    logger.info(`Wrote generated test for ${scenario.scenario_id} -> ${outputPath}`);
  }

  return writtenFiles;
}

async function readReconSnapshots(reconPath: string): Promise<ReconSnapshot[]> {
  const files = await listFiles(reconPath, '.json');
  return Promise.all(files.map((file) => readJsonFile<ReconSnapshot>(file)));
}

function buildGeneratorPrompt(scenario: Scenario, plan: string, snapshots: ReconSnapshot[]): string {
  const entryUrl =
    snapshots.find((snapshot) => snapshot.state === 'login-page')?.url ?? requireEnvValue('WEBSITE_URL');
  const websiteUrlRules = websiteUrlPromptRules(entryUrl);

  const compactSnapshots = snapshots.map((snapshot) => ({
    scenario_id: snapshot.scenario_id,
    state: snapshot.state,
    url: snapshot.url,
    action_before_snapshot: snapshot.action_before_snapshot,
    action_error: snapshot.action_error,
    elements: snapshot.elements.map((element) => ({
      tag: element.tag,
      type: element.type,
      text: element.text,
      role: element.role,
      ariaLabel: element.ariaLabel,
      ariaLive: element.ariaLive,
      className: element.className,
      label: element.label,
      placeholder: element.placeholder,
      suggestedLocator: element.suggestedLocator,
      locatorPriority: element.locatorPriority,
      uiStability: element.uiStability ?? inferUiStability(element)
    }))
  }));

  return truncate(
    [
      'Generate a runnable Playwright TypeScript test for this scenario.',
      '',
      'Rules:',
      '- Use @playwright/test.',
      '- Use TypeScript.',
      '- Use test.step.',
      '- Use process.env.WEBSITE_URL.',
      '- Use process.env.LOGIN_EMAIL.',
      '- Use process.env.LOGIN_PASSWORD.',
      websiteUrlRules,
      '- Never hardcode login credentials.',
      '- Use payload values for business data.',
      '- Prefer locators from recon snapshot suggestedLocator and locatorPriority.',
      '- Prefer getByRole, getByLabel, and getByPlaceholder.',
      '- Avoid XPath unless no stable locator exists.',
      '- Add assertions from test plan.',
      '- Assertion priority: mandatory assertions are those stated in the Markdown test plan plus stable UI (URL, route, headings, main content for that step). Toasts, snackbars, inline alerts, and getByRole("alert", ...) are optional unless the plan text explicitly requires proving that message.',
      '- Transient UI: if you assert a toast/alert, do it immediately after the action that triggers it (same test.step, before unrelated waits) and use expect(...).toBeVisible({ timeout: ... }) with a reasonable timeout.',
      '- Do not use waitForLoadState("networkidle") before asserting a toast/alert; networkidle can outlast auto-dismiss timers. Avoid blanket networkidle after login or in apps with long-polling or websockets; prefer expect on stable UI or domcontentloaded/load when needed.',
      '- If the plan does not require proving a success toast: dismiss or skip using a conditional (e.g. locator.isVisible({ timeout: 2000 }) then click close) so the test passes when the toast is already gone.',
      '- Recon elements include uiStability: when "transient", do not add mandatory visibility assertions for that element unless the Markdown plan explicitly requires that message.',
      '- Specs are written under tests/generated: imports to repo-root modules (pages/, fixtures/, playwright.config) must use ../../..., never ../... (../ resolves under tests/ and breaks).',
      '- Do not add unsupported libraries.',
      '- Output code only, no Markdown fence.',
      '',
      'Scenario JSON:',
      JSON.stringify(scenario, null, 2),
      '',
      'Markdown test plan:',
      plan,
      '',
      'Recon snapshots:',
      JSON.stringify(compactSnapshots, null, 2)
    ].join('\n'),
    120_000
  );
}

function stripCodeFence(value: string): string {
  return value.replace(/^```(?:typescript|ts)?\s*/i, '').replace(/```\s*$/i, '').trimEnd() + '\n';
}

if (require.main === module) {
  generateTests()
    .then((files) => {
      logger.info(`Generated ${files.length} Playwright test file(s).`);
    })
    .catch((error) => {
      logger.error('Test generation failed.', error);
      process.exitCode = 1;
    });
}
