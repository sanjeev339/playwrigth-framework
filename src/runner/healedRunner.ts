import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import fs from 'fs-extra';
import type { PlaywrightRunResult } from '../types';
import { getBaseEnv, getFrameworkPaths } from '../config/env';
import { listFiles, writeJsonFile } from '../utils/fileUtils';
import { logger } from '../utils/logger';

const execFileAsync = promisify(execFile);

export async function runHealedTests(options: {
  outputPath?: string;
  healedDir?: string;
} = {}): Promise<PlaywrightRunResult> {
  const env = getBaseEnv();
  const paths = getFrameworkPaths();
  const outputPath = options.outputPath ?? paths.healedRunResultPath;
  const healedDir = options.healedDir ?? paths.healedTestsDir;

  if (!(await fs.pathExists(healedDir))) {
    logger.info(`Healed tests directory does not exist: ${healedDir}`);
    const emptyResult = createEmptyResult();
    await writeJsonFile(outputPath, emptyResult);
    return emptyResult;
  }

  const healedTestFiles = (await listFiles(healedDir, '.ts'))
    .filter((file) => file.endsWith('.spec.ts'))
    .map((file) => path.relative(process.cwd(), file) || file);

  if (healedTestFiles.length === 0) {
    logger.info('No healed test files found to run.');
    const emptyResult = createEmptyResult();
    await writeJsonFile(outputPath, emptyResult);
    return emptyResult;
  }

  const args = ['playwright', 'test', ...healedTestFiles];

  if (!env.HEADLESS) {
    args.push('--headed');
  }

  const startedAt = new Date();
  let stdout = '';
  let stderr = '';
  let exitCode: number | null = 0;

  logger.info(`Running ${healedTestFiles.length} healed test(s): ${healedTestFiles.join(', ')}`);

  try {
    const result = await execFileAsync('npx', args, {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 20 * 1024 * 1024
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    stdout = execError.stdout ?? '';
    stderr = execError.stderr ?? execError.message;
    exitCode = typeof execError.code === 'number' ? execError.code : 1;
  }

  const endedAt = new Date();
  const result: PlaywrightRunResult = {
    command: `npx ${args.join(' ')}`,
    status: exitCode === 0 ? 'passed' : 'failed',
    exitCode,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    stdout,
    stderr,
    failedTestFiles: extractFailedTestFiles(`${stdout}\n${stderr}`)
  };

  await writeJsonFile(outputPath, result);
  logger.info(`Wrote Playwright healed run result -> ${outputPath}`);

  return result;
}

function extractFailedTestFiles(output: string): string[] {
  const matches = output.match(/tests\/healed\/[A-Za-z0-9_.-]+\.spec\.ts/g) ?? [];
  return [...new Set(matches)];
}

function createEmptyResult(): PlaywrightRunResult {
  return {
    command: 'npx playwright test <no-healed-tests-found>',
    status: 'passed',
    exitCode: 0,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    durationMs: 0,
    stdout: 'No healed tests found.',
    stderr: '',
    failedTestFiles: []
  };
}

if (require.main === module) {
  runHealedTests().catch(async (error) => {
    const paths = getFrameworkPaths();
    const outputPath = paths.healedRunResultPath;
    const failed: PlaywrightRunResult = {
      command: `npx playwright test <healed-runner-failure>`,
      status: 'failed',
      exitCode: 1,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 0,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      failedTestFiles: []
    };
    await writeJsonFile(outputPath, failed);
    logger.error('Playwright healed runner failed before test execution.', error);
    process.exitCode = 1;
  });
}
