import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'node:child_process';
import util from 'node:util';
import path from 'node:path';
import fs from 'fs-extra';
import dotenv from 'dotenv';
import { getFrameworkPaths } from '../config/env';

// Load the .env file from the framework root so WEBSITE_URL, INPUT paths, etc.
// are available when the MCP server runs the pipeline (UI-triggered runs)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const execPromise = util.promisify(exec);

const server = new Server(
  {
    name: 'playwright-ai-framework',
    version: '1.0.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'run_pipeline',
        description: 'Run the end-to-end testing pipeline. Runs Webwright to capture snapshots, generates playwright code via LLM, and runs it.',
        inputSchema: {
          type: 'object',
          properties: {
            inputFlowPath: { type: 'string', description: 'Path to scenarios Excel/CSV' },
            inputDataPath: { type: 'string', description: 'Path to test data JSON' },
            extractedRequirementsPath: { type: 'string', description: 'Path to extracted requirements markdown file' }
          },
          required: []
        }
      },
      {
        name: 'list_scenarios',
        description: 'Lists all available test scenarios parsed from the input Excel sheet.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'get_latest_report',
        description: 'Retrieves the results of the last pipeline execution (the final HTML/JSON report).',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'get_pipeline_log',
        description: 'Retrieves the saved execution log from the last pipeline run.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    ]
  };
});

async function savePipelineLog(paths: ReturnType<typeof getFrameworkPaths>, log: object): Promise<void> {
  try {
    await fs.ensureDir(paths.reportDir);
    const logPath = path.join(paths.reportDir, 'pipeline-execution-log.json');
    await fs.writeJson(logPath, log, { spaces: 2 });
  } catch {
    // non-fatal – log saving should never break the pipeline response
  }
}

server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
  const paths = getFrameworkPaths();

  switch (request.params.name) {
    case 'run_pipeline': {
      const startedAt = new Date().toISOString();
      try {
        const args = (request.params.arguments || {}) as any;
        const env = { ...process.env };

        // If the UI passes inputFlowPath, auto-derive ALL output folders
        // from the same parent directory — so wherever QA saved files,
        // Playwright reads and writes to that same folder automatically.
        if (args.inputFlowPath) {
          let outDir = path.dirname(args.inputFlowPath);
          if (path.basename(outDir) === 'test_cases') {
            outDir = path.dirname(outDir);
          }
          env.INPUT_FLOW_PATH = args.inputFlowPath;
          env.INPUT_DATA_PATH = args.inputDataPath || path.join(outDir, 'test_data', 'test_data.json');
          env.SCENARIO_OUTPUT_DIR = path.join(outDir, 'metadata', 'scenarios');
          env.RECON_SUMMARY_OUTPUT_DIR = path.join(outDir, 'metadata', 'recon-summary');
          env.DYNAMIC_RECON_OUTPUT_DIR = path.join(outDir, 'metadata', 'dynamic-recon');
          env.GENERATED_TEST_OUTPUT_DIR = path.join(outDir, 'playwright_scripts');
          env.GENERATED_TEST_QUARANTINE_DIR = path.join(outDir, 'metadata', 'generated-quarantine');
          env.HEALED_TEST_OUTPUT_DIR = path.join(outDir, 'playwright_scripts', 'healed');
          env.REPORT_OUTPUT_DIR = path.join(outDir, 'metadata', 'reports');
          env.GENERATION_REPORT_PATH = path.join(outDir, 'metadata', 'reports', 'generation-result.json');
          env.RUN_RESULT_PATH = path.join(outDir, 'metadata', 'reports', 'run-result.json');
          env.LOCATOR_VALIDATION_REPORT_PATH = path.join(outDir, 'metadata', 'reports', 'locator-validation.json');
          env.FINAL_REPORT_JSON_PATH = path.join(outDir, 'metadata', 'reports', 'final-report.json');
          env.FINAL_REPORT_HTML_PATH = path.join(outDir, 'metadata', 'reports', 'final-report.html');
          env.DYNAMIC_REPORT_JSON_PATH = path.join(outDir, 'metadata', 'reports', 'dynamic-run-result.json');
          env.DYNAMIC_REPORT_HTML_PATH = path.join(outDir, 'metadata', 'reports', 'dynamic-run-result.html');
          env.HEALING_REPORT_PATH = path.join(outDir, 'metadata', 'reports', 'healing-result.json');
          env.FRONTEND_REVIEW_OUTPUT_DIR = path.join(outDir, 'metadata', 'reports', 'frontend-reviews');
          env.DOCUMENT_REPORT_OUTPUT_DIR = path.join(outDir, 'metadata', 'reports', 'document-report');
        } else if (args.inputDataPath) {
          env.INPUT_DATA_PATH = args.inputDataPath;
        }

        if (args.extractedRequirementsPath) {
          env.EXTRACTED_REQUIREMENTS_PATH = args.extractedRequirementsPath;
        } else if (args.inputFlowPath) {
          const outDir = path.dirname(args.inputFlowPath);
          env.EXTRACTED_REQUIREMENTS_PATH = path.join(outDir, 'extracted_requirements.md');
        }

        // Still forward any remaining .env keys not already set above
        const envKeys = [
          'WEBSITE_URL', 'LOGIN_EMAIL', 'LOGIN_PASSWORD',
          'LLM_PROVIDER', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'GEMINI_MODEL',
          'ANTHROPIC_API_KEY',
          'HEADLESS', 'SLOW_MO', 'ACTION_DECISION_MODE',
          'LOG_LLM_IO', 'LLM_IO_MAX_CHARS',
          'ALLOW_XPATH_LOCATORS', 'ALLOW_POSITIONAL_LOCATORS',
          'INPUT_FLOW_PATH', 'INPUT_DATA_PATH', 'EXTRACTED_REQUIREMENTS_PATH',
          'FRONTEND_REVIEW_OUTPUT_DIR', 'DOCUMENT_REPORT_OUTPUT_DIR'
        ];
        for (const key of envKeys) {
          // Only fill from process.env if not already set by the args-derived logic above
          if (process.env[key] && !env[key]) env[key] = process.env[key];
        }

        const { stdout, stderr } = await execPromise('npm run pipeline', { cwd: process.cwd(), env, maxBuffer: 50 * 1024 * 1024 });
        const completedAt = new Date().toISOString();
        const summary = `Pipeline executed successfully.\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`;

        await savePipelineLog(paths, {
          status: 'success',
          startedAt,
          completedAt,
          inputFlowPath: env.INPUT_FLOW_PATH ?? null,
          inputDataPath: env.INPUT_DATA_PATH ?? null,
          stdout,
          stderr,
          summary
        });

        return {
          content: [{ type: 'text', text: summary }]
        };
      } catch (error: any) {
        const completedAt = new Date().toISOString();
        const summary = `Pipeline execution failed.\n\nError: ${error.message}\n\nSTDOUT:\n${error.stdout ?? ''}\n\nSTDERR:\n${error.stderr ?? ''}`;

        await savePipelineLog(paths, {
          status: 'failed',
          startedAt,
          completedAt,
          error: error.message,
          stdout: error.stdout ?? '',
          stderr: error.stderr ?? '',
          summary
        });

        return {
          content: [{ type: 'text', text: summary }],
          isError: true
        };
      }
    }

    case 'list_scenarios': {
      try {
        if (!(await fs.pathExists(paths.scenarioDir))) {
          return {
            content: [
              {
                type: 'text',
                text: '[]\n(No scenarios directory found. Have you built them yet?)'
              }
            ]
          };
        }
        const scenarioFiles = await fs.readdir(paths.scenarioDir);
        const scenarios = [];
        for (const file of scenarioFiles) {
          if (file.endsWith('.json')) {
            const content = await fs.readJson(path.join(paths.scenarioDir, file));
            scenarios.push({
              id: content.scenario_id,
              module: content.module,
              action: content.action,
              steps_count: content.steps?.length ?? 0
            });
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(scenarios, null, 2)
            }
          ]
        };
      } catch (error: any) {
        throw new McpError(ErrorCode.InternalError, `Failed to list scenarios: ${error.message}`);
      }
    }

    case 'get_latest_report': {
      try {
        if (!(await fs.pathExists(paths.finalReportJsonPath))) {
          return {
            content: [
              {
                type: 'text',
                text: 'No report found. Run the pipeline first.'
              }
            ]
          };
        }
        const report = await fs.readJson(paths.finalReportJsonPath);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(report, null, 2)
            }
          ]
        };
      } catch (error: any) {
        throw new McpError(ErrorCode.InternalError, `Failed to get report: ${error.message}`);
      }
    }

    case 'get_pipeline_log': {
      try {
        const logPath = path.join(paths.reportDir, 'pipeline-execution-log.json');
        if (!(await fs.pathExists(logPath))) {
          return {
            content: [{ type: 'text', text: 'No pipeline log found. Run the pipeline first.' }]
          };
        }
        const log = await fs.readJson(logPath);
        return {
          content: [{ type: 'text', text: log.summary ?? JSON.stringify(log, null, 2) }]
        };
      } catch (error: any) {
        throw new McpError(ErrorCode.InternalError, `Failed to get pipeline log: ${error.message}`);
      }
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Playwright AI Framework MCP server running on stdio');
}

run().catch((error) => {
  console.error('Fatal error running MCP server:', error);
  process.exit(1);
});
