import { spawn } from 'node:child_process';
import path from 'node:path';
import type { PlaywrightRunResult } from '../types';
import { getBaseEnv, getFrameworkPaths } from '../config/env';
import { getLatestGenerationSelection } from '../generation/generationSelection';
import { writeJsonFile } from '../utils/fileUtils';
import { logger } from '../utils/logger';

export async function runGeneratedTests(options: {
  outputPath?: string;
  generatedDir?: string;
  generationReportPath?: string;
} = {}): Promise<PlaywrightRunResult> {
  const env = getBaseEnv();
  const paths = getFrameworkPaths();
  const outputPath = options.outputPath ?? paths.runResultPath;
  const generatedDir = options.generatedDir ?? paths.generatedTestsDir;
  const generationReportPath = options.generationReportPath ?? paths.generationReportPath;
  const selection = await getLatestGenerationSelection({ generationReportPath, generatedDir });
  const generatedTestFiles = selection.generatedFiles.map((file) => path.relative(process.cwd(), file) || file);

  if (generatedTestFiles.length === 0) {
    throw new Error(`No successfully generated test files are available from ${generationReportPath}.`);
  }

  const args = ['playwright', 'test', ...generatedTestFiles];

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
      env: {
        ...process.env,
        PLAYWRIGHT_TEST_DIR: path.resolve(generatedDir, '..'),
        NODE_PATH: process.env.NODE_PATH 
          ? `${process.env.NODE_PATH}${path.delimiter}${path.join(process.cwd(), 'node_modules')}` 
          : path.join(process.cwd(), 'node_modules')
      },
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
        logger.error('Failed to start test execution process.', err);
        resolve(1);
      });
    });
  } catch (error) {
    stderr = error instanceof Error ? error.message : String(error);
    exitCode = 1;
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
  const matches = output.match(/tests\/generated\/[A-Za-z0-9_.-]+\.spec\.ts/g) ?? [];
  return [...new Set(matches)];
}

if (require.main === module) {
  runGeneratedTests().catch(async (error) => {
    const paths = getFrameworkPaths();
    const outputPath = paths.runResultPath;
    const failed: PlaywrightRunResult = {
      command: `npx playwright test <latest-successful-generated-tests>`,
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
    process.exitCode = 1;
  });
}
