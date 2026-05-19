import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  TestCaseInputSchema,
  generatePlaywrightFeature,
} from "./tools/generatePlaywrightTest";
import {
  ArtifactInputSchema,
  ArtifactScenarioListInputSchema,
  generatePlaywrightFromArtifacts,
  listArtifactScenarios,
} from "./tools/generatePlaywrightFromArtifacts";
import {
  LlmPlaywrightInputSchema,
  generatePlaywrightWithLlm,
} from "./tools/generatePlaywrightWithLlm";
import {
  LlmPlaywrightBatchInputSchema,
  generatePlaywrightBatchWithLlm,
} from "./tools/generatePlaywrightBatchWithLlm";
import {
  RunPlaywrightTestsInputSchema,
  runPlaywrightTests,
} from "./tools/runPlaywrightTests";
import {
  ArtifactLifecycleBatchInputSchema,
  runArtifactLifecycleBatch,
} from "./tools/runArtifactLifecycleBatch";

async function main(): Promise<void> {
  const server = new McpServer({
    name: "playwright-framework-generator",
    version: "0.1.0",
  });

  server.registerTool(
    "generate_playwright_test",
    {
      title: "Generate Playwright Framework Test",
      description:
        "Generates Page Object, Action, test data, spec, and fixture updates with stability validation.",
      inputSchema: TestCaseInputSchema,
    },
    async (input) => {
      const result = await generatePlaywrightFeature(input);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "list_playwright_artifact_scenarios",
    {
      title: "List Playwright Artifact Scenarios",
      description:
        "Reads scenarios_combined.csv and test_data.json, then lists test case IDs with their matching data so one scenario can be generated at a time.",
      inputSchema: ArtifactScenarioListInputSchema,
    },
    async (input) => {
      const result = listArtifactScenarios(input);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "generate_playwright_from_artifacts",
    {
      title: "Generate Playwright Test From Scenario Artifacts",
      description:
        "Reads scenarios_combined.csv and test_data.json, maps one scenario into the framework generator, and applies stability validation.",
      inputSchema: ArtifactInputSchema,
    },
    async (input) => {
      const result = await generatePlaywrightFromArtifacts(input);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "generate_playwright_with_llm",
    {
      title: "Generate Playwright Code With LLM",
      description:
        "Calls the configured LLM to draft Playwright framework files, then validates stability and writes Page Object, Action, test data, spec, and fixture updates.",
      inputSchema: LlmPlaywrightInputSchema,
    },
    async (input) => {
      const result = await generatePlaywrightWithLlm(input);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "generate_playwright_batch_with_llm",
    {
      title: "Generate Playwright Batch With LLM",
      description:
        "Lists artifact scenarios, generates the first N Playwright tests with the configured LLM, validates each one, writes accepted files, and returns browser test commands.",
      inputSchema: LlmPlaywrightBatchInputSchema,
    },
    async (input) => {
      const result = await generatePlaywrightBatchWithLlm(input);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "run_playwright_tests",
    {
      title: "Run Playwright Tests",
      description:
        "Runs selected Playwright specs. Use headed=true to open Chromium visibly on the desktop while the tests execute.",
      inputSchema: RunPlaywrightTestsInputSchema,
    },
    async (input) => {
      const result = runPlaywrightTests(input);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "run_artifact_lifecycle_batch",
    {
      title: "Run Artifact Lifecycle Batch",
      description:
        "Reads uploaded scenario CSV and test data JSON once, then sequentially generates, validates, runs, repairs, reruns, and reports Playwright results for each scenario.",
      inputSchema: ArtifactLifecycleBatchInputSchema,
    },
    async (input) => {
      const result = await runArtifactLifecycleBatch(input);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
