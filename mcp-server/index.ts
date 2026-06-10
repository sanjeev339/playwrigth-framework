import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const server = new Server(
  {
    name: "Playwright Generator",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "build_scenarios",
        description: "Run 'npm run build:scenarios' to build Playwright scenarios",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "plan",
        description: "Run 'npm run plan' to use LLM planner",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "pw_extract_actions",
        description: "Run 'npm run extract:actions'",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "pw_recon",
        description: "Run 'npm run recon' for interactive reconnaissance",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "pw_generate",
        description: "Run 'npm run generate' to generate tests",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "pw_validate",
        description: "Run 'npm run validate' to validate locators",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "pw_run_generated",
        description: "Run 'npm run run:generated' to execute generated tests",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "pw_heal",
        description: "Run 'npm run heal' to heal failing locators",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "run_artifact_lifecycle_batch",
        description: "Run 'npm run pipeline:static' to run the full static pipeline",
        inputSchema: { type: "object", properties: {} },
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  let command = "";

  switch (toolName) {
    case "pw_build_scenarios":
      command = "npm run build:scenarios";
      break;
    case "pw_plan":
      command = "npm run plan";
      break;
    case "pw_extract_actions":
      command = "npm run extract:actions";
      break;
    case "pw_recon":
      command = "npm run recon";
      break;
    case "pw_generate":
      command = "npm run generate";
      break;
    case "pw_validate":
      command = "npm run validate";
      break;
    case "pw_run_generated":
      command = "npm run run:generated";
      break;
    case "pw_heal":
      command = "npm run heal";
      break;
    case "run_artifact_lifecycle_batch":
      command = "npm run pipeline:static";
      break;
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }

  try {
    const args = (request.params.arguments || {}) as Record<string, any>;
    const env = { ...process.env };

    if (args.scenariosCsvPath) env.INPUT_FLOW_PATH = args.scenariosCsvPath;
    if (args.testDataJsonPath) env.INPUT_DATA_PATH = args.testDataJsonPath;
    if (args.outputDir) {
      env.SCENARIO_OUTPUT_DIR = `${args.outputDir}/scenarios`;
      env.SPEC_OUTPUT_DIR = `${args.outputDir}/specs`;
      env.SCENARIO_ACTION_OUTPUT_DIR = `${args.outputDir}/scenario-actions`;
      env.RECON_OUTPUT_DIR = `${args.outputDir}/recon`;
      env.RECON_SUMMARY_OUTPUT_DIR = `${args.outputDir}/recon-summary`;
      env.DYNAMIC_RECON_OUTPUT_DIR = `${args.outputDir}/dynamic-recon`;
      env.GENERATED_TEST_OUTPUT_DIR = `${args.outputDir}/tests/generated`;
      env.GENERATED_TEST_QUARANTINE_DIR = `${args.outputDir}/generated-quarantine`;
      env.HEALED_TEST_OUTPUT_DIR = `${args.outputDir}/tests/healed`;
      env.REPORT_OUTPUT_DIR = `${args.outputDir}/reports`;
      env.PLAYWRIGHT_TEST_DIR = args.outputDir;
    }

    const { stdout, stderr } = await execAsync(command, { env });
    return {
      content: [
        {
          type: "text",
          text: `Command executed: ${command}\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`,
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `Error executing ${command}:\n${error.message}\n\nSTDOUT:\n${error.stdout || ""}\n\nSTDERR:\n${error.stderr || ""}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Playwright MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
