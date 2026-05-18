import { execFileSync } from "child_process";
import * as path from "path";
import { z } from "zod";

export const RunPlaywrightTestsInputSchema = z.object({
  specPaths: z.array(z.string().min(1)).default([]).optional(),
  first10UserManagement: z.boolean().default(false).optional(),
  headed: z.boolean().default(true).optional(),
  project: z.string().min(1).default("chromium").optional(),
  env: z.string().min(1).default("dev").optional(),
  grep: z.string().optional(),
  timeoutMs: z.number().int().positive().max(1_800_000).default(600_000).optional(),
});

export type RunPlaywrightTestsInput = z.infer<
  typeof RunPlaywrightTestsInputSchema
>;

export type RunPlaywrightTestsResult = {
  ok: boolean;
  command: string;
  headed: boolean;
  browserMessage: string;
  stdout: string;
  stderr: string;
  reportCommand: string;
};

const repoRoot = process.cwd();

const FIRST_10_USER_MANAGEMENT_SPECS = Array.from({ length: 10 }, (_, index) => {
  const id = String(index + 1).padStart(3, "0");
  return `tests/user-management-tc-um-${id}`;
});

export function runPlaywrightTests(
  rawInput: unknown,
): RunPlaywrightTestsResult {
  const input = RunPlaywrightTestsInputSchema.parse(rawInput);
  const specPaths = input.first10UserManagement
    ? FIRST_10_USER_MANAGEMENT_SPECS
    : input.specPaths || [];
  const normalizedSpecPaths = specPaths.map(normalizeSpecPath);
  const args = [
    "pnpm",
    "exec",
    "playwright",
    "test",
    ...normalizedSpecPaths,
  ];

  if (input.grep) {
    args.push("--grep", input.grep);
  }

  if (input.headed) {
    args.push("--headed");
  }

  args.push(`--project=${input.project || "chromium"}`);

  try {
    const stdout = execFileSync("corepack", args, {
      cwd: repoRoot,
      env: { ...process.env, ENV: input.env || "dev" },
      encoding: "utf-8",
      stdio: "pipe",
      timeout: input.timeoutMs,
    });

    return {
      ok: true,
      command: commandForDisplay(args, input.env || "dev"),
      headed: Boolean(input.headed),
      browserMessage: browserMessage(Boolean(input.headed)),
      stdout,
      stderr: "",
      reportCommand: "corepack pnpm run report",
    };
  } catch (error) {
    const typed = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    return {
      ok: false,
      command: commandForDisplay(args, input.env || "dev"),
      headed: Boolean(input.headed),
      browserMessage: browserMessage(Boolean(input.headed)),
      stdout: typed.stdout ? String(typed.stdout) : "",
      stderr: [typed.stderr, typed.message]
        .filter(Boolean)
        .map((part) => String(part))
        .join("\n"),
      reportCommand: "corepack pnpm run report",
    };
  }
}

function normalizeSpecPath(specPath: string): string {
  const normalized = specPath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    path.isAbsolute(normalized) ||
    normalized.includes("../") ||
    !normalized.startsWith("tests/")
  ) {
    throw new Error(
      `Spec path must be a relative path inside tests/: ${specPath}`,
    );
  }
  return normalized;
}

function commandForDisplay(args: string[], env: string): string {
  return `ENV=${env} corepack ${args.map(shellQuote).join(" ")}`;
}

function shellQuote(value: string): string {
  return value.includes(" ") ? `'${value.replaceAll("'", "'\\''")}'` : value;
}

function browserMessage(headed: boolean): string {
  if (headed) {
    return "Chromium opens visibly on the desktop while the test runs.";
  }
  return "Browser runs headless, so no browser window is shown.";
}
