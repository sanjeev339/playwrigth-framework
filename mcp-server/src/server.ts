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

  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
