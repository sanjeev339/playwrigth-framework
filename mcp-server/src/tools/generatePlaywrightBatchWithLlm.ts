import { z } from "zod";
import { listArtifactScenarios } from "../generators/artifactInputAdapter";
import {
  LlmGenerationResult,
  generatePlaywrightWithLlm,
} from "../generators/llmPlaywrightGenerator";

export const LlmPlaywrightBatchInputSchema = z.object({
  scenariosCsvPath: z.string().min(1),
  testDataJsonPath: z.string().min(1),
  baseUrl: z.string().optional(),
  provider: z.enum(["gemini", "openai", "anthropic"]).optional(),
  model: z.string().optional(),
  prompt: z.string().optional(),
  loginBefore: z.boolean().optional(),
  automationSuitability: z
    .enum(["Yes", "No", "Partial", "All"])
    .default("Yes")
    .optional(),
  limit: z.number().int().positive().max(25).default(10).optional(),
  offset: z.number().int().min(0).default(0).optional(),
  stopOnFailure: z.boolean().default(false).optional(),
  options: z
    .object({
      dryRun: z.boolean().default(true),
      overwrite: z.boolean().default(false),
      updateFixtures: z.boolean().default(true),
    })
    .default({ dryRun: true, overwrite: false, updateFixtures: true }),
});

export type LlmPlaywrightBatchInput = z.infer<
  typeof LlmPlaywrightBatchInputSchema
>;

export type LlmBatchScenarioResult = {
  scenarioId: string;
  title?: string;
  ok: boolean;
  feature: string;
  specPath?: string;
  result: LlmGenerationResult;
};

export type LlmBatchGenerationResult = {
  ok: boolean;
  dryRun: boolean;
  requested: number;
  attempted: number;
  generated: number;
  failed: number;
  scenarios: LlmBatchScenarioResult[];
  headedBrowserCommand?: string;
  normalBrowserCommand?: string;
  warnings: string[];
};

const DEFAULT_BATCH_PROMPT = [
  "Use the LLM to generate complete Playwright framework code from this artifact scenario.",
  "Always login first using the existing LoginAction.loginAndWaitForLoad() helper, then follow the scenario steps.",
  "Generate exactly four files: Page Object, Action, test data, and spec.",
  "Use the existing fixture pattern.",
  "Do not use XPath, waitForTimeout, default imports, static LoginAction calls, direct page actions inside the spec, generated class imports inside the spec, or .page access inside the spec.",
  "Page-object assertion methods must start with expect.",
  "The spec must use generated fixtures and must include a final page-object assertion.",
].join(" ");

export async function generatePlaywrightBatchWithLlm(
  rawInput: unknown,
): Promise<LlmBatchGenerationResult> {
  const input = LlmPlaywrightBatchInputSchema.parse(rawInput);
  const dryRun = input.options.dryRun;
  const listed = listArtifactScenarios({
    scenariosCsvPath: input.scenariosCsvPath,
    testDataJsonPath: input.testDataJsonPath,
    automationSuitability: input.automationSuitability,
    limit: input.limit,
    offset: input.offset,
  });

  const warnings: string[] = [];
  const scenarios: LlmBatchScenarioResult[] = [];

  for (const scenario of listed.scenarios) {
    const scenarioId = String(scenario.scenarioId || "");
    if (!scenarioId) {
      warnings.push("Skipped a scenario row without Test Case ID.");
      continue;
    }

    if (!scenario.hasTestData) {
      warnings.push(`Skipped ${scenarioId} because it has no test data.`);
      continue;
    }

    const featureName = [String(scenario.module || "Generated Feature"), scenarioId]
      .filter(Boolean)
      .join(" ");
    const result = await generatePlaywrightWithLlm({
      prompt: input.prompt || DEFAULT_BATCH_PROMPT,
      provider: input.provider,
      model: input.model,
      featureName,
      artifact: {
        scenarioId,
        scenariosCsvPath: input.scenariosCsvPath,
        testDataJsonPath: input.testDataJsonPath,
      },
      baseUrl: input.baseUrl,
      loginBefore: input.loginBefore ?? true,
      options: input.options,
    });
    const specPath = result.files.find((file) =>
      file.path.startsWith("tests/"),
    )?.path;

    scenarios.push({
      scenarioId,
      title: String(scenario.title || ""),
      ok: result.ok,
      feature: result.feature,
      specPath,
      result,
    });

    if (!result.ok && input.stopOnFailure) break;
  }

  const generatedSpecPaths = scenarios
    .filter((scenario) => scenario.ok && scenario.specPath)
    .map((scenario) => scenario.specPath!);

  return {
    ok: scenarios.length > 0 && scenarios.every((scenario) => scenario.ok),
    dryRun,
    requested: listed.returned,
    attempted: scenarios.length,
    generated: scenarios.filter((scenario) => scenario.ok).length,
    failed: scenarios.filter((scenario) => !scenario.ok).length,
    scenarios,
    headedBrowserCommand: buildPlaywrightCommand(generatedSpecPaths, true),
    normalBrowserCommand: buildPlaywrightCommand(generatedSpecPaths, false),
    warnings,
  };
}

function buildPlaywrightCommand(
  specPaths: string[],
  headed: boolean,
): string | undefined {
  if (!specPaths.length) return undefined;
  const headedFlag = headed ? " --headed" : "";
  return `ENV=dev corepack pnpm exec playwright test ${specPaths
    .map(shellQuote)
    .join(" ")}${headedFlag} --project=chromium`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
