import path from 'node:path';
import fs from 'fs-extra';
import { getFrameworkPaths } from '../config/env';
import type {
  GenerationReport,
  GenerationScenarioResult,
  LocatorValidationReport,
  PlaywrightRunResult,
  Scenario
} from '../types';
import type { ReconDecision } from '../recon/reconDecisionTypes';
import { escapeHtml, listFiles, readJsonFile, toSafeFileName, writeJsonFile, writeTextFile } from '../utils/fileUtils';
import { logger } from '../utils/logger';

interface ReconDecisionDetail {
  step?: number;
  rawStep: string;
  decisionSource: string;
  selectedLocator: string | null;
  llmReason?: string;
  actionStatus: string;
  actionError?: string | null;
}

interface SmartReconSummary {
  total_steps: number;
  deterministic_success_count: number;
  llm_used_count: number;
  failed_action_count: number;
  skipped_action_count: number;
  unsafe_locator_count: number;
  decision_details: ReconDecisionDetail[];
}

interface FinalScenarioReport {
  scenario_id: string;
  module?: string;
  action?: string;
  generated_file?: string;
  healed_file?: string;
  status: 'passed' | 'failed' | 'blocked' | 'unknown';
  generation_status: 'generated' | 'failed' | 'not-run';
  generation_failed_stage?: string;
  validation_warnings: string[];
  failure_reason?: string;
  healing_status: 'not-needed' | 'healed' | 'not-run';
  recon_snapshot_paths: string[];
  smart_recon: SmartReconSummary;
}

interface FinalReport {
  generated_at: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    blocked: number;
    unknown: number;
  };
  scenarios: FinalScenarioReport[];
}

export async function writeFinalReport(options: {
  scenarioDir?: string;
  generatedDir?: string;
  healedDir?: string;
  reconDir?: string;
  generationReportPath?: string;
  runResultPath?: string;
  validationPath?: string;
  outputJsonPath?: string;
  outputHtmlPath?: string;
} = {}): Promise<FinalReport> {
  const paths = getFrameworkPaths();
  const scenarioDir = options.scenarioDir ?? paths.scenarioDir;
  const generatedDir = options.generatedDir ?? paths.generatedTestsDir;
  const healedDir = options.healedDir ?? paths.healedTestsDir;
  const reconDir = options.reconDir ?? paths.reconDir;
  const generationReportPath = options.generationReportPath ?? paths.generationReportPath;
  const runResultPath = options.runResultPath ?? paths.runResultPath;
  const validationPath = options.validationPath ?? paths.locatorValidationReportPath;
  const outputJsonPath = options.outputJsonPath ?? paths.finalReportJsonPath;
  const outputHtmlPath = options.outputHtmlPath ?? paths.finalReportHtmlPath;
  const healedRunResultPath = paths.healedRunResultPath;

  const scenarios = await Promise.all((await listFiles(scenarioDir, '.json')).map((file) => readJsonFile<Scenario>(file)));
  const generationReport = (await fs.pathExists(generationReportPath))
    ? await readJsonFile<GenerationReport>(generationReportPath)
    : undefined;
  const runResult = (await fs.pathExists(runResultPath)) ? await readJsonFile<PlaywrightRunResult>(runResultPath) : undefined;
  const healedRunResult = (await fs.pathExists(healedRunResultPath)) ? await readJsonFile<PlaywrightRunResult>(healedRunResultPath) : undefined;
  const validation = (await fs.pathExists(validationPath)) ? await readJsonFile<LocatorValidationReport>(validationPath) : undefined;

  const scenarioReports: FinalScenarioReport[] = [];

  for (const scenario of scenarios) {
    const safeScenarioId = toSafeFileName(scenario.scenario_id);
    const generatedFile = path.join(generatedDir, `${safeScenarioId}.spec.ts`);
    const healedFile = path.join(healedDir, `${safeScenarioId}.spec.ts`);
    const generationResult = generationReport?.scenarios.find((result) => result.scenario_id === scenario.scenario_id);
    const reconSnapshots = await listFiles(path.join(reconDir, safeScenarioId), '.json');
    const smartRecon = await readSmartReconSummary(reconSnapshots);
    const generatedRelative =
      generationResult?.status !== 'failed' && (await fs.pathExists(generatedFile))
        ? path.relative(process.cwd(), generatedFile)
        : undefined;
    const healedRelative =
      generationResult?.status !== 'failed' && (await fs.pathExists(healedFile))
        ? path.relative(process.cwd(), healedFile)
        : undefined;
    const validationWarnings =
      validation?.warnings
        .filter((warning) => warning.file.endsWith(`${safeScenarioId}.spec.ts`))
        .map((warning) => `[${warning.severity}] ${warning.rule}: ${warning.message}`) ?? [];
    const status = scenarioStatus(
      runResult,
      healedRunResult,
      safeScenarioId,
      generationResult,
      Boolean(generationReport),
      Boolean(generatedRelative),
      Boolean(healedRelative)
    );

    scenarioReports.push({
      scenario_id: scenario.scenario_id,
      module: scenario.module,
      action: scenario.action,
      generated_file: generatedRelative,
      healed_file: healedRelative,
      status,
      generation_status: generationResult?.status ?? 'not-run',
      generation_failed_stage: generationResult?.failed_stage,
      validation_warnings: validationWarnings,
      failure_reason: failureReason(status, generationResult, runResult),
      healing_status: healedRelative ? 'healed' : status === 'failed' || status === 'blocked' ? 'not-run' : 'not-needed',
      recon_snapshot_paths: reconSnapshots.map((file) => path.relative(process.cwd(), file)),
      smart_recon: smartRecon
    });
  }

  const report: FinalReport = {
    generated_at: new Date().toISOString(),
    summary: {
      total: scenarioReports.length,
      passed: scenarioReports.filter((scenario) => scenario.status === 'passed').length,
      failed: scenarioReports.filter((scenario) => scenario.status === 'failed').length,
      blocked: scenarioReports.filter((scenario) => scenario.status === 'blocked').length,
      unknown: scenarioReports.filter((scenario) => scenario.status === 'unknown').length
    },
    scenarios: scenarioReports
  };

  await writeJsonFile(outputJsonPath, report);
  await writeTextFile(outputHtmlPath, renderHtml(report));
  logger.info(`Wrote final reports -> ${outputJsonPath}, ${outputHtmlPath}`);
  return report;
}

function scenarioStatus(
  runResult: PlaywrightRunResult | undefined,
  healedRunResult: PlaywrightRunResult | undefined,
  safeScenarioId: string,
  generationResult: GenerationScenarioResult | undefined,
  hasGenerationReport: boolean,
  hasGeneratedFile: boolean,
  hasHealedFile: boolean
): 'passed' | 'failed' | 'blocked' | 'unknown' {
  if (generationResult?.status === 'failed') {
    return 'blocked';
  }

  if (hasGenerationReport && generationResult?.status !== 'generated') {
    return 'unknown';
  }

  if (hasGenerationReport && generationResult?.status === 'generated' && !hasGeneratedFile) {
    return 'unknown';
  }

  if (hasHealedFile && healedRunResult) {
    const failedHealed = healedRunResult.failedTestFiles.some((file) => file.includes(`${safeScenarioId}.spec.ts`));
    return failedHealed ? 'failed' : 'passed';
  }

  if (!runResult) {
    return 'unknown';
  }

  if (runResult.status === 'passed') {
    return 'passed';
  }

  const failedThisScenario = runResult.failedTestFiles.some((file) => file.includes(`${safeScenarioId}.spec.ts`));
  return failedThisScenario || runResult.failedTestFiles.length === 0 ? 'failed' : 'unknown';
}

function failureReason(
  status: FinalScenarioReport['status'],
  generationResult: GenerationScenarioResult | undefined,
  runResult: PlaywrightRunResult | undefined
): string | undefined {
  if (status === 'blocked' && generationResult?.status === 'failed') {
    return `${generationResult.failed_stage ?? 'generation'}: ${generationResult.error ?? 'Test generation failed.'}`;
  }

  return status === 'failed' && runResult ? summarizeFailure(runResult) : undefined;
}

function summarizeFailure(runResult: PlaywrightRunResult): string {
  const combined = `${runResult.stderr}\n${runResult.stdout}`.trim();
  return combined.split('\n').filter(Boolean).slice(0, 8).join('\n');
}

async function readSmartReconSummary(snapshotFiles: string[]): Promise<SmartReconSummary> {
  const decisions: ReconDecision[] = [];

  for (const snapshotFile of snapshotFiles) {
    const snapshot = await readJsonFile<{ decision?: ReconDecision | null }>(snapshotFile);
    if (snapshot.decision) {
      decisions.push(snapshot.decision);
    }
  }

  const uniqueDecisions = dedupeDecisions(decisions);
  const unsafeLocatorCount = uniqueDecisions.reduce(
    (count, decision) =>
      count +
      decision.validatedCandidates.filter((validation) => !validation.isSafe).length +
      (decision.actionError && /strict_mode_risk|unsafe|zero elements|matched \d+ elements/i.test(decision.actionError) ? 1 : 0),
    0
  );

  return {
    total_steps: uniqueDecisions.length,
    deterministic_success_count: uniqueDecisions.filter(
      (decision) => decision.decisionSource === 'deterministic' && decision.actionStatus === 'success'
    ).length,
    llm_used_count: uniqueDecisions.filter((decision) => decision.decisionSource === 'llm').length,
    failed_action_count: uniqueDecisions.filter((decision) => decision.actionStatus === 'failed').length,
    skipped_action_count: uniqueDecisions.filter((decision) => decision.actionStatus === 'skipped').length,
    unsafe_locator_count: unsafeLocatorCount,
    decision_details: uniqueDecisions.map((decision) => ({
      step: decision.stepNo,
      rawStep: decision.rawStep,
      decisionSource: decision.decisionSource,
      selectedLocator: decision.selectedLocator,
      llmReason: decision.llmReason,
      actionStatus: decision.actionStatus,
      actionError: decision.actionError
    }))
  };
}

function dedupeDecisions(decisions: ReconDecision[]): ReconDecision[] {
  const byStep = new Map<string, ReconDecision>();

  for (const decision of decisions) {
    const key = `${decision.stepNo ?? 'na'}:${decision.rawStep}`;
    const existing = byStep.get(key);
    if (!existing || existing.actionStatus !== 'success') {
      byStep.set(key, decision);
    }
  }

  return [...byStep.values()];
}

function renderHtml(report: FinalReport): string {
  const rows = report.scenarios
    .map(
      (scenario) => `
        <tr>
          <td>${escapeHtml(scenario.scenario_id)}</td>
          <td>${escapeHtml(scenario.module ?? '')}</td>
          <td>${escapeHtml(scenario.action ?? '')}</td>
          <td><span class="status ${scenario.status}">${escapeHtml(scenario.status)}</span></td>
          <td>${escapeHtml(scenario.generation_status)}</td>
          <td>${escapeHtml(scenario.generated_file ?? '')}</td>
          <td>${escapeHtml(scenario.healed_file ?? '')}</td>
          <td>${escapeHtml(scenario.healing_status)}</td>
          <td>
            <div>Total: ${scenario.smart_recon.total_steps}</div>
            <div>Deterministic: ${scenario.smart_recon.deterministic_success_count}</div>
            <div>LLM: ${scenario.smart_recon.llm_used_count}</div>
            <div>Failed: ${scenario.smart_recon.failed_action_count}</div>
            <div>Skipped: ${scenario.smart_recon.skipped_action_count}</div>
            <div>Unsafe: ${scenario.smart_recon.unsafe_locator_count}</div>
          </td>
          <td>${scenario.smart_recon.decision_details
            .map(
              (detail) => `<div class="decision">
                <strong>${escapeHtml(detail.step === undefined ? 'Step' : `Step ${detail.step}`)}</strong>
                <div>${escapeHtml(detail.rawStep)}</div>
                <div>Source: ${escapeHtml(detail.decisionSource)} | Status: ${escapeHtml(detail.actionStatus)}</div>
                <div>Locator: ${escapeHtml(detail.selectedLocator ?? '')}</div>
                <div>Reason: ${escapeHtml(detail.llmReason ?? '')}</div>
                <div>Error: ${escapeHtml(detail.actionError ?? '')}</div>
              </div>`
            )
            .join('')}</td>
          <td>${scenario.validation_warnings.map((warning) => `<div>${escapeHtml(warning)}</div>`).join('')}</td>
          <td>${escapeHtml(scenario.failure_reason ?? '')}</td>
          <td>${scenario.recon_snapshot_paths.map((snapshot) => `<div>${escapeHtml(snapshot)}</div>`).join('')}</td>
        </tr>`
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Playwright AI Framework Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #1f2937; }
    h1 { margin-bottom: 8px; }
    .summary { display: flex; gap: 16px; margin: 20px 0; }
    .metric { border: 1px solid #d1d5db; border-radius: 8px; padding: 12px 16px; }
    .metric strong { display: block; font-size: 24px; }
    table { border-collapse: collapse; width: 100%; font-size: 14px; }
    th, td { border: 1px solid #d1d5db; padding: 10px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; }
    .status { font-weight: 700; text-transform: uppercase; }
    .passed { color: #047857; }
    .failed { color: #b91c1c; }
    .blocked { color: #7c3aed; }
    .unknown { color: #92400e; }
    .decision { border-bottom: 1px solid #e5e7eb; margin-bottom: 8px; padding-bottom: 8px; max-width: 420px; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <h1>Playwright AI Framework Report</h1>
  <div>Generated at ${escapeHtml(report.generated_at)}</div>
  <section class="summary">
    <div class="metric"><strong>${report.summary.total}</strong>Total</div>
    <div class="metric"><strong>${report.summary.passed}</strong>Passed</div>
    <div class="metric"><strong>${report.summary.failed}</strong>Failed</div>
    <div class="metric"><strong>${report.summary.blocked}</strong>Blocked</div>
    <div class="metric"><strong>${report.summary.unknown}</strong>Unknown</div>
  </section>
  <table>
    <thead>
      <tr>
        <th>Scenario</th>
        <th>Module</th>
        <th>Action</th>
        <th>Status</th>
        <th>Generation</th>
        <th>Generated</th>
        <th>Healed</th>
        <th>Healing</th>
        <th>Smart Recon</th>
        <th>Decision Details</th>
        <th>Validation Warnings</th>
        <th>Failure Reason</th>
        <th>Recon Snapshots</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>
`;
}

if (require.main === module) {
  writeFinalReport()
    .then((report) => {
      logger.info(`Report completed for ${report.summary.total} scenario(s).`);
    })
    .catch((error) => {
      logger.error('Report writing failed.', error);
      process.exitCode = 1;
    });
}
