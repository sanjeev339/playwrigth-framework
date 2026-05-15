import * as fs from "fs";
import * as path from "path";
import { generatePlaywrightFeature } from "./tools/generatePlaywrightTest";

async function main(): Promise<void> {
  const inputPath = process.argv[2];

  if (!inputPath) {
    console.error(
      "Usage: corepack pnpm mcp:generate <request.json> [--dry-run]",
    );
    process.exit(1);
  }

  const absoluteInputPath = path.resolve(process.cwd(), inputPath);
  const rawInput = JSON.parse(fs.readFileSync(absoluteInputPath, "utf-8"));

  if (process.argv.includes("--dry-run")) {
    rawInput.options = {
      ...(rawInput.options || {}),
      dryRun: true,
    };
  }

  const result = await generatePlaywrightFeature(rawInput);
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
