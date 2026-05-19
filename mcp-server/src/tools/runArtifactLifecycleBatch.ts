import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import {
  buildTestCaseInputFromArtifacts,
  getArtifactScenarioBlock,
  listArtifactScenarios,
} from "../generators/artifactInputAdapter";
import { generatePlaywrightWithLlm } from "../generators/llmPlaywrightGenerator";
import { resolveUserVisibleIdentifierFromPortal } from "../generators/locatorDiscovery";

export const ArtifactLifecycleBatchInputSchema = z.object({
  scenariosCsvPath: z.string().min(1),
  testDataJsonPath: z.string().min(1),
  baseUrl: z.string().optional(),
  provider: z.enum(["gemini", "openai", "anthropic"]).optional(),
  model: z.string().optional(),
  env: z.string().min(1).default("dev").optional(),
  headed: z.boolean().default(true).optional(),
  automationSuitability: z
    .enum(["Yes", "No", "Partial", "All"])
    .default("Yes")
    .optional(),
  maxRepairAttempts: z.number().int().min(0).max(5).default(2).optional(),
  stopOnFailure: z.boolean().default(false).optional(),
  outputDir: z.string().optional(),
});

export type ArtifactLifecycleBatchInput = z.infer<
  typeof ArtifactLifecycleBatchInputSchema
>;

type LifecycleStatus = "passed" | "failed" | "blocked" | "generated_only";

type LifecycleAttempt = {
  attempt: number;
  generationOk: boolean;
  runOk?: boolean;
  failureReason?: string;
  resolvedVisibleUserIdentifier?: string;
  screenshotPath?: string;
  videoPath?: string;
  errorContextPath?: string;
};

type LifecycleScenarioResult = {
  scenarioId: string;
  title: string;
  generatedFiles: string[];
  runCommand?: string;
  attempts: LifecycleAttempt[];
  finalStatus: LifecycleStatus;
  failureReason?: string;
  screenshotPath?: string;
  videoPath?: string;
  reportPath?: string;
};

export type ArtifactLifecycleBatchResult = {
  ok: boolean;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  generatedOnly: number;
  reportPath: string;
  scenarios: LifecycleScenarioResult[];
};

const repoRoot = process.cwd();

export async function runArtifactLifecycleBatch(
  rawInput: unknown,
): Promise<ArtifactLifecycleBatchResult> {
  const input = ArtifactLifecycleBatchInputSchema.parse(rawInput);
  const outputDir = input.outputDir || path.join(repoRoot, "generated_output");
  fs.mkdirSync(outputDir, { recursive: true });
  pruneMissingGeneratedFixtureEntries();
  const reportPath = path.join(
    outputDir,
    `playwright_batch_result_${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );

  const listed = listArtifactScenarios({
    scenariosCsvPath: input.scenariosCsvPath,
    testDataJsonPath: input.testDataJsonPath,
    automationSuitability: input.automationSuitability,
    limit: 200,
    offset: 0,
  });

  const scenarioResults: LifecycleScenarioResult[] = [];
  for (const scenario of listed.scenarios) {
    const scenarioId = String(scenario.scenarioId || "");
    const title = String(scenario.title || scenarioId);
    const result = await runOneScenario(input, scenarioId, title, scenario);
    scenarioResults.push(result);
    writeLifecycleReport(reportPath, scenarioResults);

    if (
      input.stopOnFailure &&
      (result.finalStatus === "failed" || result.finalStatus === "blocked")
    ) {
      break;
    }
  }

  writeLifecycleReport(reportPath, scenarioResults);
  return summarizeResults(reportPath, scenarioResults);
}

function pruneMissingGeneratedFixtureEntries(): void {
  pruneFixtureFile({
    fixturePath: "fixtures/page.fixture.ts",
    importPattern:
      /import\s+\{\s*(UserManagementTcUm\d+Page)\s*\}\s+from\s+['"`](\.\.\/page_objects\/user-management-tc-um-\d+\/UserManagementTcUm\d+Page)['"`];\n/g,
    typePattern: /^\s*userManagementTcUm\d+Page:\s*UserManagementTcUm\d+Page;\n/gm,
    blockPattern:
      /^\s*userManagementTcUm\d+Page:\s*async\s*\(\{\s*page\s*\},\s*use\s*\)\s*=>\s*\{\n\s*await use\(new UserManagementTcUm\d+Page\(page\)\);\n\s*\},\n/gm,
  });
  pruneFixtureFile({
    fixturePath: "fixtures/test.fixture.ts",
    importPattern:
      /import\s+\{\s*(UserManagementTcUm\d+Action)\s*\}\s+from\s+['"`](\.\.\/actions\/user-management-tc-um-\d+\/UserManagementTcUm\d+Action)['"`];\n/g,
    typePattern: /^\s*userManagementTcUm\d+Action:\s*UserManagementTcUm\d+Action;\n/gm,
    blockPattern:
      /^\s*userManagementTcUm\d+Action:\s*async\s*\(\{\s*page\s*\},\s*use\s*\)\s*=>\s*\{\n\s*await use\(new UserManagementTcUm\d+Action\(page\)\);\n\s*\},\n/gm,
  });
}

function pruneFixtureFile(options: {
  fixturePath: string;
  importPattern: RegExp;
  typePattern: RegExp;
  blockPattern: RegExp;
}): void {
  const absolutePath = path.join(repoRoot, options.fixturePath);
  if (!fs.existsSync(absolutePath)) return;

  let content = fs.readFileSync(absolutePath, "utf-8");
  const missingClasses = new Set<string>();
  content = content.replace(
    options.importPattern,
    (line: string, className: string, importPath: string) => {
      const importedFile = path.join(repoRoot, `${importPath.replace("../", "")}.ts`);
      if (fs.existsSync(importedFile)) return line;
      missingClasses.add(className);
      return "";
    },
  );

  for (const className of missingClasses) {
    const fixtureName =
      className.charAt(0).toLowerCase() +
      className.slice(1).replace(/(?:Page|Action)$/, "");
    const memberName = className.endsWith("Page")
      ? `${fixtureName}Page`
      : `${fixtureName}Action`;
    content = content.replace(
      new RegExp(`^\\s*${memberName}:\\s*${className};\\n`, "gm"),
      "",
    );
    content = content.replace(
      new RegExp(
        `^\\s*${memberName}:\\s*async\\s*\\(\\{\\s*page\\s*\\},\\s*use\\s*\\)\\s*=>\\s*\\{\\n\\s*await use\\(new ${className}\\(page\\)\\);\\n\\s*\\},\\n`,
        "gm",
      ),
      "",
    );
  }

  fs.writeFileSync(absolutePath, content);
}

async function runOneScenario(
  input: ArtifactLifecycleBatchInput,
  scenarioId: string,
  title: string,
  scenario: Record<string, unknown>,
): Promise<LifecycleScenarioResult> {
  const generatedFiles: string[] = [];
  const attempts: LifecycleAttempt[] = [];
  const emailBlockReason = classifyEmailLinkBlock(scenario);
  let resolvedTestData: Record<string, string | number | boolean> = {};
  let visibleIdentifierBlock = getArtifactScenarioBlock({
    scenarioId,
    scenariosCsvPath: input.scenariosCsvPath,
    testDataJsonPath: input.testDataJsonPath,
    baseUrl: input.baseUrl,
    loginBefore: true,
    options: {
      dryRun: true,
      overwrite: false,
      updateFixtures: true,
    },
  });

  if (visibleIdentifierBlock) {
    const resolution = await tryResolveVisibleUserIdentifier(input, scenarioId);
    if (resolution.ok && resolution.testData) {
      resolvedTestData = resolution.testData;
      visibleIdentifierBlock = getArtifactScenarioBlock({
        scenarioId,
        scenariosCsvPath: input.scenariosCsvPath,
        testDataJsonPath: input.testDataJsonPath,
        baseUrl: input.baseUrl,
        testData: resolvedTestData,
        loginBefore: true,
        options: {
          dryRun: true,
          overwrite: false,
          updateFixtures: true,
        },
      });
      attempts.push({
        attempt: 0,
        generationOk: true,
        resolvedVisibleUserIdentifier:
          resolution.visibleIdentifier || "resolved from user list",
      });
    }

    if (visibleIdentifierBlock) {
      const detail = resolution.reason
        ? `${visibleIdentifierBlock.message} (${resolution.reason})`
        : visibleIdentifierBlock.message;
      return {
        scenarioId,
        title,
        generatedFiles,
        attempts: [
          ...attempts,
          {
            attempt: 1,
            generationOk: false,
            failureReason: detail,
          },
        ],
        finalStatus: "blocked",
        failureReason: resolution.reason || visibleIdentifierBlock.reason,
      };
    }
  }

  let repairPrompt = baseLifecyclePrompt();
  const maxAttempts = (input.maxRepairAttempts ?? 2) + 1;
  let lastFailure = "";
  let lastArtifacts: FailureArtifacts = {};
  let runCommand = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const generation = await generateScenarioWithFailureCapture({
      prompt: repairPrompt,
      input,
      scenarioId,
      testData: resolvedTestData,
    });
    generatedFiles.splice(
      0,
      generatedFiles.length,
      ...generation.files.map((file) => file.path),
    );

    if (!generation.ok) {
      lastFailure = generation.issues
        .map((issue) => `${issue.file}: ${issue.rule} - ${issue.message}`)
        .join("; ");
      attempts.push({
        attempt,
        generationOk: false,
        failureReason: lastFailure,
      });
      if (
        generation.issues.some(
          (issue) => issue.rule === "visible_user_identifier_required",
        )
      ) {
        return {
          scenarioId,
          title,
          generatedFiles,
          attempts,
          finalStatus: "blocked",
          failureReason: "visible_user_identifier_required",
        };
      }
      repairPrompt = repairPromptWithFailure(repairPrompt, lastFailure);
      continue;
    }

    const specPath = generation.files.find((file) =>
      file.path.startsWith("tests/"),
    )?.path;
    if (!specPath) {
      lastFailure = "Generation succeeded but no test spec path was returned.";
      attempts.push({
        attempt,
        generationOk: true,
        failureReason: lastFailure,
      });
      repairPrompt = repairPromptWithFailure(repairPrompt, lastFailure);
      continue;
    }

    const run = runSpec(specPath, input);
    runCommand = run.command;
    lastArtifacts = findLatestFailureArtifacts(scenarioId);
    attempts.push({
      attempt,
      generationOk: true,
      runOk: run.ok,
      failureReason: run.ok ? undefined : summarizeRunFailure(run, lastArtifacts),
      screenshotPath: lastArtifacts.screenshotPath,
      videoPath: lastArtifacts.videoPath,
      errorContextPath: lastArtifacts.errorContextPath,
    });

    if (run.ok) {
      return {
        scenarioId,
        title,
        generatedFiles,
        runCommand,
        attempts,
        finalStatus: "passed",
        reportPath: "reports/playwright-report/index.html",
      };
    }

    lastFailure = summarizeRunFailure(run, lastArtifacts);
    if (emailBlockReason) {
      return {
        scenarioId,
        title,
        generatedFiles,
        runCommand,
        attempts,
        finalStatus: "blocked",
        failureReason: emailBlockReason,
        screenshotPath: lastArtifacts.screenshotPath,
        videoPath: lastArtifacts.videoPath,
        reportPath: "reports/playwright-report/index.html",
      };
    }
    repairPrompt = repairPromptWithFailure(repairPrompt, lastFailure);
  }

  return {
    scenarioId,
    title,
    generatedFiles,
    runCommand,
    attempts,
    finalStatus: lastFailure ? "failed" : "generated_only",
    failureReason: lastFailure || "Scenario did not pass.",
    screenshotPath: lastArtifacts.screenshotPath,
    videoPath: lastArtifacts.videoPath,
    reportPath: "reports/playwright-report/index.html",
  };
}

async function generateScenarioWithFailureCapture(options: {
  prompt: string;
  input: ArtifactLifecycleBatchInput;
  scenarioId: string;
  testData?: Record<string, string | number | boolean>;
}): Promise<Awaited<ReturnType<typeof generatePlaywrightWithLlm>>> {
  const missingKey = missingProviderKey(options.input.provider);
  if (missingKey) {
    return {
      ok: false,
      dryRun: false,
      feature: `User Management ${options.scenarioId}`,
      provider: options.input.provider || process.env.LLM_PROVIDER || "gemini",
      model: options.input.model,
      files: [],
      issues: [
        {
          severity: "error",
          file: "llm-provider",
          rule: "llm-provider-error",
          message: `Missing ${missingKey}. Add the API key in Desktop Settings and restart the Playwright MCP server.`,
        },
      ],
      warnings: [],
    };
  }

  try {
    return await generatePlaywrightWithLlm({
      prompt: options.prompt,
      provider: options.input.provider,
      model: options.input.model,
      featureName: `User Management ${options.scenarioId}`,
      artifact: {
        scenarioId: options.scenarioId,
        scenariosCsvPath: options.input.scenariosCsvPath,
        testDataJsonPath: options.input.testDataJsonPath,
      },
      baseUrl: options.input.baseUrl,
      testData: options.testData || {},
      loginBefore: true,
      domRecon: {
        enabled: true,
        headed: options.input.headed ?? true,
        outputDir: path.join(
          options.input.outputDir || path.join(repoRoot, "generated_output"),
          "locator-registry",
        ),
      },
      options: {
        dryRun: false,
        overwrite: true,
        updateFixtures: true,
      },
    });
  } catch (error) {
    return {
      ok: false,
      dryRun: false,
      feature: `User Management ${options.scenarioId}`,
      provider: options.input.provider || process.env.LLM_PROVIDER || "gemini",
      model: options.input.model,
      files: [],
      issues: [
        {
          severity: "error",
          file: "llm-provider",
          rule: "llm-provider-error",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      warnings: [],
    };
  }
}

async function tryResolveVisibleUserIdentifier(
  input: ArtifactLifecycleBatchInput,
  scenarioId: string,
): Promise<{
  ok: boolean;
  reason?: string;
  visibleIdentifier?: string;
  testData?: Record<string, string | number | boolean>;
}> {
  let testData: Record<string, string | number | boolean> = {};
  try {
    const artifactCase = buildTestCaseInputFromArtifacts({
      scenarioId,
      scenariosCsvPath: input.scenariosCsvPath,
      testDataJsonPath: input.testDataJsonPath,
      baseUrl: input.baseUrl,
      loginBefore: true,
      options: {
        dryRun: true,
        overwrite: false,
        updateFixtures: false,
      },
    });
    testData = artifactCase.testData;
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const userId = String(testData.userId || testData.uuid || "").trim();
  if (!userId) {
    return { ok: false, reason: "missing_user_id" };
  }

  const resolution = await resolveUserVisibleIdentifierFromPortal({
    userId,
    headed: input.headed ?? true,
    outputDir: path.join(
      input.outputDir || path.join(repoRoot, "generated_output"),
      "locator-registry",
    ),
  });

  if (!resolution.ok || !resolution.resolved) {
    return {
      ok: false,
      reason: resolution.reason || "uuid_not_found_in_user_list",
    };
  }

  const merged = {
    ...testData,
    ...resolution.resolved,
  };
  return {
    ok: true,
    testData: merged,
    visibleIdentifier: String(
      resolution.resolved.resolvedVisibleUserIdentifier ||
        resolution.resolved.emailAddress ||
        resolution.resolved.fullName ||
        "",
    ),
  };
}

function missingProviderKey(provider?: string): string {
  const resolved = (provider || process.env.LLM_PROVIDER || "gemini")
    .toLowerCase()
    .trim();
  if (resolved === "openai" && !process.env.OPENAI_API_KEY) {
    return "OPENAI_API_KEY";
  }
  if (resolved === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    return "ANTHROPIC_API_KEY";
  }
  if (resolved === "gemini" && !process.env.GEMINI_API_KEY) {
    return "GEMINI_API_KEY";
  }
  return "";
}

function baseLifecyclePrompt(): string {
  return [
    "Generate Playwright framework code from this artifact scenario.",
    "Follow the project skill rules and existing layered structure.",
    "Use Page Object, Action, test data, spec, and fixture updates.",
    "The spec must use generated fixtures only.",
    "Use tiered Locator[] candidates with firstVisibleLocator. Do not use locator.or(...). XPath is only a Tier 3 fallback candidate.",
    "If runtime failure context is provided, repair locators, navigation steps, and action ordering based on that context.",
  ].join(" ");
}

function repairPromptWithFailure(prompt: string, failure: string): string {
  return [
    prompt,
    "",
    "Previous lifecycle attempt failed in the browser or validation.",
    "Repair the generated framework code using this failure context:",
    failure.slice(0, 6000),
  ].join("\n");
}

function classifyEmailLinkBlock(scenario: Record<string, unknown>): string {
  const text = [
    scenario.title,
    scenario.objective,
    scenario.preconditions,
    ...(Array.isArray(scenario.stepsPreview) ? scenario.stepsPreview : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    /\b(invite|invitation|invite\s+email|invitation\s+email|email\s+link|open\s+email|registration\s+link|reset\s+link|forgot\s+password|password\s+reset)\b/.test(
      text,
    )
  ) {
    return "email_link_required";
  }
  return "";
}

type RunResult = {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
};

function runSpec(specPath: string, input: ArtifactLifecycleBatchInput): RunResult {
  const args = ["pnpm", "exec", "playwright", "test", specPath];
  if (input.headed) args.push("--headed");
  args.push("--project=chromium");
  const command = `ENV=${input.env || "dev"} corepack ${args.join(" ")}`;

  try {
    const stdout = execFileSync("corepack", args, {
      cwd: repoRoot,
      env: { ...process.env, ENV: input.env || "dev" },
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 600_000,
    });
    return { ok: true, command, stdout, stderr: "" };
  } catch (error) {
    const typed = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    return {
      ok: false,
      command,
      stdout: typed.stdout ? String(typed.stdout) : "",
      stderr: [typed.stderr, typed.message]
        .filter(Boolean)
        .map((part) => String(part))
        .join("\n"),
    };
  }
}

type FailureArtifacts = {
  screenshotPath?: string;
  videoPath?: string;
  errorContextPath?: string;
  errorContext?: string;
};

function findLatestFailureArtifacts(scenarioId: string): FailureArtifacts {
  const resultRoot = path.join(repoRoot, "reports/test-results");
  if (!fs.existsSync(resultRoot)) return {};

  const files = walkFiles(resultRoot)
    .map((filePath) => ({ filePath, stat: fs.statSync(filePath) }))
    .filter(({ filePath }) =>
      filePath.toLowerCase().includes(scenarioId.toLowerCase()),
    )
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  const errorContextPath = files.find(({ filePath }) =>
    filePath.endsWith("error-context.md"),
  )?.filePath;
  const screenshotPath = files.find(({ filePath }) =>
    filePath.endsWith(".png"),
  )?.filePath;
  const videoPath = files.find(({ filePath }) =>
    filePath.endsWith(".webm"),
  )?.filePath;

  return {
    errorContextPath,
    screenshotPath,
    videoPath,
    errorContext:
      errorContextPath && fs.existsSync(errorContextPath)
        ? fs.readFileSync(errorContextPath, "utf-8")
        : undefined,
  };
}

function summarizeRunFailure(
  run: RunResult,
  artifacts: FailureArtifacts,
): string {
  return [
    artifacts.errorContext || "",
    run.stdout,
    run.stderr,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 8000);
}

function walkFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function writeLifecycleReport(
  reportPath: string,
  scenarios: LifecycleScenarioResult[],
): string {
  fs.writeFileSync(
    reportPath,
    JSON.stringify(summarizeResults(reportPath, scenarios), null, 2),
  );
  return reportPath;
}

function summarizeResults(
  reportPath: string,
  scenarios: LifecycleScenarioResult[],
): ArtifactLifecycleBatchResult {
  return {
    ok: scenarios.every((scenario) => scenario.finalStatus === "passed"),
    total: scenarios.length,
    passed: scenarios.filter((scenario) => scenario.finalStatus === "passed")
      .length,
    failed: scenarios.filter((scenario) => scenario.finalStatus === "failed")
      .length,
    blocked: scenarios.filter((scenario) => scenario.finalStatus === "blocked")
      .length,
    generatedOnly: scenarios.filter(
      (scenario) => scenario.finalStatus === "generated_only",
    ).length,
    reportPath,
    scenarios,
  };
}
