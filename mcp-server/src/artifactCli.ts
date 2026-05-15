import { generatePlaywrightFromArtifacts } from "./tools/generatePlaywrightFromArtifacts";

async function main(): Promise<void> {
  const [scenarioId, scenariosCsvPath, testDataJsonPath, baseUrl] =
    process.argv.slice(2);

  if (!scenarioId || !scenariosCsvPath || !testDataJsonPath) {
    console.error(
      "Usage: corepack pnpm mcp:generate:artifacts <scenarioId> <scenarios.csv> <test_data.json> [baseUrl] [--write]",
    );
    process.exit(1);
  }

  const result = await generatePlaywrightFromArtifacts({
    scenarioId,
    scenariosCsvPath,
    testDataJsonPath,
    baseUrl,
    options: {
      dryRun: !process.argv.includes("--write"),
      overwrite: false,
      updateFixtures: true,
    },
  });

  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
