import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DesktopConfig, DiagnosticItem } from "../shared/types";
import type { SettingsStore } from "./settingsStore";

const execFileAsync = promisify(execFile);

export async function runDiagnostics(
  settings: SettingsStore,
): Promise<DiagnosticItem[]> {
  const config = settings.getConfig();
  const items: DiagnosticItem[] = [];

  items.push(
    checkPath(
      "project-path",
      "Project path",
      config.projectPath,
      "Choose the OrchestAI repository root in Settings.",
    ),
  );
  items.push(
    checkPath(
      "output-dir",
      "Output directory",
      config.outputDir,
      "Choose or create an output directory in Settings.",
      true,
    ),
  );
  items.push(checkOutputDirectoryWritable(config.outputDir));

  const enabledServers = config.servers.filter((server) => server.enabled);
  const needsPython = enabledServers.some(
    (server) =>
      server.command.includes("python") ||
      server.args.some((arg) => arg.endsWith(".py")),
  );
  const needsPlaywrightGenerator = enabledServers.some(
    (server) =>
      server.id === "playwright" || server.args.includes("mcp:server"),
  );

  if (needsPython) {
    const pythonCheck = await checkPython(config.pythonPath);
    items.push(pythonCheck);

    for (const dependency of ["mcp", "openpyxl", "fitz", "faker"]) {
      items.push(await checkPythonImport(config.pythonPath, dependency));
    }
  } else {
    items.push({
      id: "python-not-required",
      label: "Python dependencies",
      status: "pass",
      detail: "No enabled Python MCP servers require Python for this project.",
    });
  }

  if (needsPlaywrightGenerator) {
    items.push(
      await checkCommand(
        "corepack",
        ["--version"],
        "Corepack for Playwright MCP",
        "Enable Corepack or install pnpm so the Playwright MCP server can start.",
      ),
    );
    items.push(
      checkPath(
        "playwright-mcp-server",
        "Playwright MCP server",
        path.join(config.projectPath, "mcp-server", "src", "server.ts"),
        "Use the Playwright framework repository root as projectPath.",
      ),
    );
  }

  items.push(checkServerFiles(config));
  items.push(checkProviderKey(config, settings));

  return items;
}

async function checkCommand(
  command: string,
  args: string[],
  label: string,
  remediation: string,
): Promise<DiagnosticItem> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: 8000,
    });
    return {
      id: `command-${command}`,
      label,
      status: "pass",
      detail: `${command} ${args.join(" ")} -> ${`${stdout}${stderr}`.trim()}`,
    };
  } catch (error) {
    return {
      id: `command-${command}`,
      label,
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
      remediation,
    };
  }
}

function checkPath(
  id: string,
  label: string,
  targetPath: string,
  remediation: string,
  createable = false,
): DiagnosticItem {
  const exists = fs.existsSync(targetPath);
  return {
    id,
    label,
    status: exists ? "pass" : createable ? "warn" : "fail",
    detail: exists ? targetPath : `${targetPath} does not exist.`,
    remediation: exists ? undefined : remediation,
  };
}

function checkOutputDirectoryWritable(outputDir: string): DiagnosticItem {
  const probePath = path.join(
    outputDir,
    `.orchestai-write-test-${process.pid}-${Date.now()}.tmp`,
  );
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(probePath, "ok");
    fs.unlinkSync(probePath);
    return {
      id: "output-dir-writable",
      label: "Output directory write access",
      status: "pass",
      detail: `${outputDir} is writable.`,
    };
  } catch (error) {
    try {
      if (fs.existsSync(probePath)) fs.unlinkSync(probePath);
    } catch {
      // Best effort cleanup only.
    }
    return {
      id: "output-dir-writable",
      label: "Output directory write access",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
      remediation:
        "Choose an output directory that the desktop app can create and write to.",
    };
  }
}

async function checkPython(pythonPath: string): Promise<DiagnosticItem> {
  try {
    const { stdout, stderr } = await execFileAsync(pythonPath, ["--version"], {
      timeout: 8000,
    });
    const output = `${stdout}${stderr}`.trim();
    const match = /Python\s+(\d+)\.(\d+)\.(\d+)/.exec(output);
    const major = Number(match?.[1] ?? 0);
    const minor = Number(match?.[2] ?? 0);
    const ok = major > 3 || (major === 3 && minor >= 10);
    return {
      id: "python-version",
      label: "Python 3.10+",
      status: ok ? "pass" : "fail",
      detail: output || "Python version could not be determined.",
      remediation: ok
        ? undefined
        : "Create a Python 3.10+ venv and set pythonPath to venv/bin/python.",
    };
  } catch (error) {
    return {
      id: "python-version",
      label: "Python 3.10+",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
      remediation: "Set pythonPath to a valid Python 3.10+ executable.",
    };
  }
}

async function checkPythonImport(
  pythonPath: string,
  moduleName: string,
): Promise<DiagnosticItem> {
  try {
    await execFileAsync(
      pythonPath,
      ["-c", `import ${moduleName}; print("ok")`],
      { timeout: 8000 },
    );
    return {
      id: `dependency-${moduleName}`,
      label: `Python dependency: ${moduleName}`,
      status: "pass",
      detail: `${moduleName} imports successfully.`,
    };
  } catch {
    return {
      id: `dependency-${moduleName}`,
      label: `Python dependency: ${moduleName}`,
      status: "fail",
      detail: `${moduleName} is not available from ${pythonPath}.`,
      remediation:
        "Set Settings > Python path to /Users/pi-in-185/OrchestAI/venv/bin/python, or activate the project venv and run: pip install -r requirements.txt",
    };
  }
}

function checkServerFiles(config: DesktopConfig): DiagnosticItem {
  const missing = config.servers
    .filter((server) => server.enabled)
    .flatMap((server) => server.args)
    .filter((arg) => arg.endsWith(".py") && !fs.existsSync(arg));
  return {
    id: "server-files",
    label: "MCP server files",
    status: missing.length ? "fail" : "pass",
    detail: missing.length
      ? `Missing: ${missing.join(", ")}`
      : "All enabled modular server files exist.",
    remediation: missing.length
      ? "Use the OrchestAI repository root as projectPath and refresh Settings."
      : undefined,
  };
}

function checkProviderKey(
  config: DesktopConfig,
  settings: SettingsStore,
): DiagnosticItem {
  const ref = config.apiKeyRefs[config.llmProvider];
  const key = settings.getSecret(ref);
  return {
    id: "provider-key",
    label: `${config.llmProvider} API key`,
    status: key ? "pass" : "fail",
    detail: key
      ? "API key is configured."
      : `No ${config.llmProvider} API key is configured.`,
    remediation: key
      ? undefined
      : "Add the selected provider API key in Settings.",
  };
}

export function remediationCommand(projectPath: string): string {
  return [
    `cd ${quote(projectPath)}`,
    "python3.10 -m venv venv",
    "source venv/bin/activate",
    "pip install -r requirements.txt",
  ].join("\n");
}

function quote(value: string): string {
  return value.includes(" ") ? `"${value.replaceAll('"', '\\"')}"` : value;
}
