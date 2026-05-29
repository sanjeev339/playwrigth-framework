import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PlaywrightRunResult } from '../types';
import { getBaseEnv } from '../config/env';
import { resolveFromRoot, writeJsonFile } from '../utils/fileUtils';
import { logger } from '../utils/logger';

const execFileAsync = promisify(execFile);

export async function runGeneratedTests(options: {
  outputPath?: string;
  testDir?: string;
} = {}): Promise<PlaywrightRunResult> {
  const env = getBaseEnv();
  const testDir = options.testDir ?? process.env.PLAYWRIGHT_TEST_DIR ?? 'tests/generated';
  const outputPath = options.outputPath ?? resolveFromRoot('reports', 'run-result.json');
  const args = ['playwright', 'test', testDir];

  if (!env.HEADLESS) {
    args.push('--headed');
  }

  const startedAt = new Date();
  let stdout = '';
  let stderr = '';
  let exitCode: number | null = 0;

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
  logger.info(`Wrote Playwright run result -> ${outputPath}`);

  return result;
}

function extractFailedTestFiles(output: string): string[] {
  const matches = output.match(/tests\/(?:generated|healed)\/[A-Za-z0-9_.-]+\.spec\.ts/g) ?? [];
  return [...new Set(matches)];
}

if (require.main === module) {
  runGeneratedTests().catch(async (error) => {
    const outputPath = resolveFromRoot('reports', 'run-result.json');
    const failed: PlaywrightRunResult = {
      command: 'npx playwright test tests/generated',
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
    logger.error('Playwright runner failed before test execution.', error);
  });
}
