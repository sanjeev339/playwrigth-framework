import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  TestCaseInputSchema,
  generatePlaywrightFeature,
} from "./tools/generatePlaywrightTest";
import {
  ArtifactInputSchema,
  generatePlaywrightFromArtifacts,
} from "./tools/generatePlaywrightFromArtifacts";

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

  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
