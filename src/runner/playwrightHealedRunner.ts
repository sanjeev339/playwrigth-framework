import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'fs-extra';
import type { PlaywrightRunResult } from '../types';
import { getBaseEnv, getFrameworkPaths } from '../config/env';
import { readJsonFile, writeJsonFile } from '../utils/fileUtils';
import { logger } from '../utils/logger';

interface HealingResult {
  generated_at: string;
  status: 'skipped' | 'healed';
  healedFiles: string[];
  reason?: string;
}

export async function runHealedTests(): Promise<void> {
  const env = getBaseEnv();
  const paths = getFrameworkPaths();
  const healingReportPath = paths.healingReportPath;
  const runResultPath = paths.runResultPath;

  if (!(await fs.pathExists(healingReportPath))) {
    logger.info('No healing report found. Skipping healed test execution.');
    return;
  }

  const healingResult = await readJsonFile<HealingResult>(healingReportPath);
  if (healingResult.status === 'skipped' || healingResult.healedFiles.length === 0) {
    logger.info('Healing was skipped or no test files were healed. Skipping healed test execution.');
    return;
  }

  const healedTestFiles = healingResult.healedFiles.map((file) => path.relative(process.cwd(), file) || file);
  logger.info(`Running ${healedTestFiles.length} healed test file(s)...`);

  const args = ['playwright', 'test', ...healedTestFiles];
  if (!env.HEADLESS) {
    args.push('--headed');
  }

  const startedAt = new Date();
  let stdout = '';
  let stderr = '';
  let exitCode: number | null = 0;

  try {
    const child = spawn('npx', args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe']
    });

    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      process.stdout.write(chunk);
    });

    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      process.stderr.write(chunk);
    });

    exitCode = await new Promise<number | null>((resolve) => {
      child.on('close', (code) => {
        resolve(code);
      });
      child.on('error', (err) => {
        logger.error('Failed to start healed test execution process.', err);
        resolve(1);
      });
    });
  } catch (error) {
    stderr = error instanceof Error ? error.message : String(error);
    exitCode = 1;
  }

  const endedAt = new Date();
  const failedHealedFiles = extractFailedTestFiles(`${stdout}\n${stderr}`);
  logger.info(`Healed test run completed. Failed healed files: ${failedHealedFiles.length}`);

  // Merge results back into run-result.json
  if (await fs.pathExists(runResultPath)) {
    const runResult = await readJsonFile<PlaywrightRunResult>(runResultPath);

    logger.info('Merging healed run results back into run-result.json...');

    for (const healedFile of healedTestFiles) {
      // Find scenario ID, e.g. TC-UM-002 from tests/healed/TC-UM-002.spec.ts
      const filename = path.basename(healedFile); // TC-UM-002.spec.ts
      const scenarioId = filename.replace(/\.spec\.ts$/, '');
      const originalGeneratedFile = `tests/generated/${filename}`;

      const isFailed = failedHealedFiles.some((f) => path.basename(f) === filename);

      if (!isFailed) {
        logger.info(`Healed test PASSED: ${scenarioId}. Removing from failures.`);
        // Remove from failedTestFiles list
        runResult.failedTestFiles = runResult.failedTestFiles.filter(
          (f) => path.basename(f) !== filename
        );
      } else {
        logger.info(`Healed test STILL FAILING: ${scenarioId}. Keeping in failures.`);
        // Ensure it is present in failedTestFiles list
        if (!runResult.failedTestFiles.some((f) => path.basename(f) === filename)) {
          runResult.failedTestFiles.push(originalGeneratedFile);
        }
      }
    }

    // Update overall status
    if (runResult.failedTestFiles.length === 0) {
      runResult.status = 'passed';
    } else {
      runResult.status = 'failed';
    }

    // Append output logs
    runResult.stdout = `${runResult.stdout}\n\n--- HEALED RUN OUTPUT ---\n${stdout}`;
    runResult.stderr = `${runResult.stderr}\n\n--- HEALED RUN OUTPUT ---\n${stderr}`;
    runResult.endedAt = endedAt.toISOString();
    runResult.durationMs += endedAt.getTime() - startedAt.getTime();

    await writeJsonFile(runResultPath, runResult);
    logger.info(`Updated run-result.json -> ${runResultPath}`);
  } else {
    logger.warn(`run-result.json not found at ${runResultPath}; cannot merge healed test results.`);
  }
}

function extractFailedTestFiles(output: string): string[] {
  const matches = output.match(/tests\/healed\/[A-Za-z0-9_.-]+\.spec\.ts/g) ?? [];
  return [...new Set(matches)];
}

if (require.main === module) {
  runHealedTests().catch((error) => {
    logger.error('Playwright healed runner failed.', error);
    process.exitCode = 1;
  });
}
