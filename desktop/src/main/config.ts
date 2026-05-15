import path from "node:path";
import fs from "node:fs";
import type {
  ApiKeyRefs,
  DesktopConfig,
  LlmProvider,
  ServerConfig,
} from "../shared/types";

const MODULAR_SERVERS = [
  ["planner", "Planner", "qa_orchestrator/planner_server.py"],
  ["data", "Data", "qa_orchestrator/data_server.py"],
  ["workflow", "Workflow", "qa_orchestrator/workflow_server.py"],
  ["utils", "Utils", "qa_orchestrator/utils_server.py"],
  ["compliance", "Compliance", "qa_orchestrator/compliance_server.py"],
] as const;

const MODULAR_SERVER_IDS: ReadonlySet<string> = new Set(
  MODULAR_SERVERS.map(([id]) => id),
);
const PLAYWRIGHT_SERVER_ID = "playwright";

export function inferProjectPath(appPath: string, cwd = process.cwd()): string {
  const candidates = [
    process.env.ORCHESTAI_PROJECT_PATH,
    process.env.PLAYWRIGHT_FRAMEWORK_PATH,
    cwd,
    path.resolve(cwd, ".."),
    appPath,
    path.resolve(appPath, ".."),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (
      isOrchestAiProject(candidate) ||
      isPlaywrightFrameworkProject(candidate)
    ) {
      return path.resolve(candidate);
    }
  }
  return path.resolve(cwd, "..");
}

export function inferPythonPath(projectPath: string): string {
  const candidates = [
    path.join(projectPath, "venv", "bin", "python"),
    path.join(projectPath, ".venv", "bin", "python"),
    path.join(projectPath, "venv", "Scripts", "python.exe"),
    path.join(projectPath, ".venv", "Scripts", "python.exe"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? "python3";
}

export function createDefaultConfig(
  appPath: string,
  cwd = process.cwd(),
): DesktopConfig {
  const projectPath = inferProjectPath(appPath, cwd);
  return {
    projectPath,
    pythonPath: inferPythonPath(projectPath),
    outputDir: path.join(projectPath, "generated_output"),
    llmProvider: "gemini",
    apiKeyRefs: {
      gemini: "gemini",
      openai: "openai",
      anthropic: "anthropic",
      figma: "figma",
    },
    servers: createDefaultServers(
      projectPath,
      inferPythonPath(projectPath),
      "gemini",
    ),
  };
}

export function createDefaultServers(
  projectPath: string,
  pythonPath: string,
  llmProvider: LlmProvider,
): ServerConfig[] {
  const hasQaServers = isOrchestAiProject(projectPath);
  const hasPlaywrightGenerator = isPlaywrightFrameworkProject(projectPath);
  const qaServers = MODULAR_SERVERS.map(([id, name, script]) => ({
    id,
    name,
    command: pythonPath,
    args: [path.join(projectPath, script)],
    env: {
      LLM_PROVIDER: llmProvider,
    },
    enabled: hasQaServers,
  }));
  const playwrightServer: ServerConfig = {
    id: PLAYWRIGHT_SERVER_ID,
    name: "Playwright Generator",
    command: "corepack",
    args: ["pnpm", "mcp:server"],
    env: {},
    enabled: hasPlaywrightGenerator,
  };
  return [...qaServers, playwrightServer];
}

export function normalizeConfig(
  config: DesktopConfig,
  appPath: string,
): DesktopConfig {
  const defaults = createDefaultConfig(appPath);
  const projectPath = config.projectPath || defaults.projectPath;
  const pythonPath = resolvePythonPath(config.pythonPath, projectPath);
  const llmProvider = config.llmProvider || defaults.llmProvider;
  const defaultServers = createDefaultServers(
    projectPath,
    pythonPath,
    llmProvider,
  );
  const defaultsById = new Map(
    defaultServers.map((server) => [server.id, server]),
  );
  const configuredServers = config.servers?.length
    ? mergeDefaultServers(config.servers, defaultServers)
    : defaultServers;
  const servers = configuredServers.map((server) =>
    normalizeServerConfig(
      server,
      defaultsById.get(server.id),
      projectPath,
      llmProvider,
    ),
  );

  return {
    ...defaults,
    ...config,
    projectPath,
    pythonPath,
    llmProvider,
    apiKeyRefs: normalizeApiKeyRefs(config.apiKeyRefs),
    servers,
  };
}

export function resolvePythonPath(
  savedPath: string | undefined,
  projectPath: string,
): string {
  const inferred = inferPythonPath(projectPath);
  if (!savedPath || savedPath === "python3" || savedPath === "python") {
    return inferred;
  }
  return savedPath;
}

export function normalizeApiKeyRefs(refs: ApiKeyRefs = {}): ApiKeyRefs {
  return {
    gemini: refs.gemini || "gemini",
    openai: refs.openai || "openai",
    anthropic: refs.anthropic || "anthropic",
    figma: refs.figma || "figma",
  };
}

export function refreshServerDefaults(config: DesktopConfig): DesktopConfig {
  const defaultsById = new Map(
    createDefaultServers(
      config.projectPath,
      config.pythonPath,
      config.llmProvider,
    ).map((server) => [server.id, server]),
  );
  return {
    ...config,
    servers: config.servers.map((server) => {
      const defaultServer = defaultsById.get(server.id);
      if (!defaultServer) return server;
      return {
        ...server,
        command: defaultServer.command,
        args: defaultServer.args,
        enabled: defaultServer.enabled,
        env: {
          ...server.env,
          ...defaultServer.env,
        },
      };
    }),
  };
}

function isOrchestAiProject(projectPath: string): boolean {
  return fs.existsSync(path.join(projectPath, "qa_orchestrator"));
}

function isPlaywrightFrameworkProject(projectPath: string): boolean {
  return (
    fs.existsSync(path.join(projectPath, "playwright.config.ts")) &&
    fs.existsSync(path.join(projectPath, "mcp-server"))
  );
}

function normalizeServerConfig(
  server: ServerConfig,
  defaultServer: ServerConfig | undefined,
  projectPath: string,
  llmProvider: LlmProvider,
): ServerConfig {
  if (defaultServer) {
    return {
      ...server,
      command: defaultServer.command,
      args: defaultServer.args,
      enabled: defaultServer.enabled,
      env: {
        ...server.env,
        ...defaultServer.env,
        LLM_PROVIDER: llmProvider,
      },
    };
  }

  return {
    ...server,
    command: MODULAR_SERVER_IDS.has(server.id)
      ? inferPythonPath(projectPath)
      : resolvePythonPath(server.command, projectPath),
    env: {
      ...server.env,
      LLM_PROVIDER: server.env?.LLM_PROVIDER || llmProvider,
    },
  };
}

function mergeDefaultServers(
  servers: ServerConfig[],
  defaults: ServerConfig[],
): ServerConfig[] {
  const seen = new Set(servers.map((server) => server.id));
  return [...servers, ...defaults.filter((server) => !seen.has(server.id))];
}
