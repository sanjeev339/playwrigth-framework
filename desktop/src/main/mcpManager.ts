import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import type { DesktopConfig, ServerConfig, ServerStatus, ToolCallRequest, ToolCallResult, ToolInfo } from "../shared/types";
import { logger } from "./logger";
import { encodeMcpMessage, extractToolTextContent, McpFrameParser, type JsonRpcResponse } from "./mcpProtocol";
import type { SettingsStore } from "./settingsStore";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

interface ManagedServer {
  config: ServerConfig;
  process?: ChildProcessWithoutNullStreams;
  status: ServerStatus;
  parser: McpFrameParser;
  nextId: number;
  pending: Map<number, PendingRequest>;
  tools: ToolInfo[];
  failedAt?: number;
  stderrTail: string[];
}

const REQUEST_TIMEOUT_MS = 120_000;
const FAILED_RESTART_COOLDOWN_MS = 10_000;

export class McpManager extends EventEmitter {
  private readonly servers = new Map<string, ManagedServer>();
  private readonly settings: SettingsStore;

  constructor(settings: SettingsStore) {
    super();
    this.settings = settings;
  }

  loadConfig(config: DesktopConfig): void {
    const existing = new Set(this.servers.keys());
    for (const serverConfig of config.servers) {
      existing.delete(serverConfig.id);
      const current = this.servers.get(serverConfig.id);
      if (current) {
        current.config = serverConfig;
        current.status.name = serverConfig.name;
      } else {
        this.servers.set(serverConfig.id, {
          config: serverConfig,
          status: {
            id: serverConfig.id,
            name: serverConfig.name,
            health: "stopped",
            toolCount: 0
          },
          parser: new McpFrameParser(),
          nextId: 1,
          pending: new Map(),
          tools: [],
          stderrTail: []
        });
      }
    }
    for (const staleId of existing) {
      void this.stop(staleId);
      this.servers.delete(staleId);
    }
    this.emit("status");
  }

  statuses(): ServerStatus[] {
    return [...this.servers.values()].map((server) => ({ ...server.status }));
  }

  allTools(): ToolInfo[] {
    return [...this.servers.values()].flatMap((server) => server.tools);
  }

  async startEnabled(): Promise<ServerStatus[]> {
    for (const server of this.servers.values()) {
      if (server.config.enabled && this.canAutoStart(server)) {
        await this.start(server.config.id);
      }
    }
    return this.statuses();
  }

  async start(serverId: string): Promise<ServerStatus> {
    const server = this.requireServer(serverId);
    if (server.status.health === "ready" || server.status.health === "starting") {
      return { ...server.status };
    }

    server.status = {
      ...server.status,
      health: "starting",
      lastError: undefined,
      toolCount: 0
    };
    server.failedAt = undefined;
    server.tools = [];
    server.stderrTail = [];
    server.parser = new McpFrameParser();
    this.emit("status");

    const env = this.buildServerEnv(server.config);
    logger.info("mcp", `Starting ${server.config.name}: ${server.config.command} ${server.config.args.join(" ")}`);
    server.process = spawn(server.config.command, server.config.args, {
      cwd: this.settings.getConfig().projectPath,
      env,
      stdio: "pipe"
    });

    server.status.pid = server.process.pid;
    server.process.stdout.on("data", (chunk: Buffer) => this.handleStdout(server, chunk));
    server.process.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString("utf8").trim();
      if (message) {
        appendStderr(server, message);
        logger.warn(server.config.name, message);
      }
    });
    server.process.on("error", (error) => this.failServer(server, error.message));
    server.process.on("exit", (code, signal) => {
      if (server.status.health !== "stopped") {
        const reason = code === 0 ? "Server exited." : withStderrTail(server, `Server exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`);
        this.failServer(server, reason);
      }
    });

    try {
      await this.request(server, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "OrchestAI Desktop",
          version: "0.1.0"
        }
      }, 30_000);
      this.notify(server, "notifications/initialized", {});
      const result = await this.request(server, "tools/list", {}, 30_000) as { tools?: Array<Record<string, unknown>> };
      server.tools = (result.tools || []).map((tool) => ({
        name: String(tool.name || ""),
        description: String(tool.description || ""),
        inputSchema: (tool.inputSchema || {}) as Record<string, unknown>,
        serverId: server.config.id,
        serverName: server.config.name
      })).filter((tool) => tool.name);
      server.status = {
        ...server.status,
        health: "ready",
        toolCount: server.tools.length,
        lastError: undefined
      };
      logger.info("mcp", `${server.config.name} ready with ${server.tools.length} tools.`);
      this.emit("status");
      return { ...server.status };
    } catch (error) {
      this.failServer(server, error instanceof Error ? error.message : String(error));
      return { ...server.status };
    }
  }

  async stop(serverId: string): Promise<ServerStatus> {
    const server = this.requireServer(serverId);
    for (const [, pending] of server.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Server stopped."));
    }
    server.pending.clear();
    server.tools = [];
    server.failedAt = undefined;
    if (server.process && !server.process.killed) {
      server.process.kill();
    }
    server.process = undefined;
    server.status = {
      id: server.config.id,
      name: server.config.name,
      health: "stopped",
      toolCount: 0
    };
    this.emit("status");
    return { ...server.status };
  }

  async stopAll(): Promise<ServerStatus[]> {
    for (const serverId of this.servers.keys()) {
      await this.stop(serverId);
    }
    return this.statuses();
  }

  async listTools(): Promise<ToolInfo[]> {
    await this.startEnabled();
    return this.allTools();
  }

  async callTool(request: ToolCallRequest): Promise<ToolCallResult> {
    const server = this.requireServer(request.serverId);
    if (server.status.health !== "ready") {
      await this.start(server.config.id);
    }
    if (server.status.health !== "ready") {
      throw new Error(server.status.lastError || `${server.config.name} is not ready.`);
    }
    const raw = await this.request(server, "tools/call", {
      name: request.toolName,
      arguments: request.args
    }, REQUEST_TIMEOUT_MS);
    return {
      serverId: request.serverId,
      toolName: request.toolName,
      raw,
      content: extractToolTextContent(raw)
    };
  }

  private request(server: ManagedServer, method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    if (!server.process || server.process.killed) {
      return Promise.reject(new Error(`${server.config.name} is not running.`));
    }
    const id = server.nextId++;
    const message = encodeMcpMessage({
      jsonrpc: "2.0",
      id,
      method,
      params
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        server.pending.delete(id);
        reject(new Error(`${server.config.name} request '${method}' timed out.`));
      }, timeoutMs);
      server.pending.set(id, { resolve, reject, timer });
      const stream = server.process?.stdin;
      if (!stream || stream.destroyed || !stream.writable) {
        clearTimeout(timer);
        server.pending.delete(id);
        reject(new Error(`${server.config.name} stdin is not writable.`));
        return;
      }
      stream.write(message, (error) => {
        if (!error) return;
        clearTimeout(timer);
        server.pending.delete(id);
        reject(new Error(`${server.config.name} stdin write failed: ${error.message}`));
      });
    });
  }

  private notify(server: ManagedServer, method: string, params: Record<string, unknown>): void {
    const stream = server.process?.stdin;
    if (!stream || stream.destroyed || !stream.writable) {
      logger.warn(server.config.name, `Skipped MCP notification '${method}' because stdin is not writable.`);
      return;
    }
    stream.write(encodeMcpMessage({ jsonrpc: "2.0", method, params }), (error) => {
      if (error) {
        logger.warn(server.config.name, `MCP notification '${method}' write failed: ${error.message}`);
      }
    });
  }

  private handleStdout(server: ManagedServer, chunk: Buffer): void {
    const messages = server.parser.push(chunk);
    for (const message of messages) {
      this.handleMessage(server, message);
    }
  }

  private handleMessage(server: ManagedServer, message: JsonRpcResponse): void {
    if (typeof message.id !== "number") {
      return;
    }
    const pending = server.pending.get(message.id);
    if (!pending) return;
    server.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new Error(message.error.message));
    } else {
      pending.resolve(message.result);
    }
  }

  private failServer(server: ManagedServer, message: string): void {
    logger.error(server.config.name, message);
    for (const [, pending] of server.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    server.pending.clear();
    server.tools = [];
    server.failedAt = Date.now();
    if (server.process && !server.process.killed) {
      server.process.kill();
    }
    server.process = undefined;
    server.status = {
      ...server.status,
      health: "failed",
      toolCount: 0,
      lastError: classifyServerError(message),
      pid: undefined
    };
    this.emit("status");
  }

  private canAutoStart(server: ManagedServer): boolean {
    if (server.status.health === "ready" || server.status.health === "starting") {
      return false;
    }
    if (server.status.health === "failed" && server.failedAt && Date.now() - server.failedAt < FAILED_RESTART_COOLDOWN_MS) {
      return false;
    }
    return true;
  }

  private requireServer(serverId: string): ManagedServer {
    const server = this.servers.get(serverId);
    if (!server) throw new Error(`Unknown MCP server '${serverId}'.`);
    return server;
  }

  private buildServerEnv(server: ServerConfig): NodeJS.ProcessEnv {
    const config = this.settings.getConfig();
    const gemini = this.settings.getSecret(config.apiKeyRefs.gemini);
    const openai = this.settings.getSecret(config.apiKeyRefs.openai);
    const anthropic = this.settings.getSecret(config.apiKeyRefs.anthropic);
    const figma = this.settings.getSecret(config.apiKeyRefs.figma);
    return {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      ORCHESTAI_OUTPUT_DIR: config.outputDir,
      ...server.env,
      LLM_PROVIDER: config.llmProvider,
      GEMINI_API_KEY: gemini,
      OPENAI_API_KEY: openai,
      ANTHROPIC_API_KEY: anthropic,
      FIGMA_API_TOKEN: figma,
      PYTHONPATH: [
        config.projectPath,
        path.join(config.projectPath, "qa_orchestrator"),
        process.env.PYTHONPATH
      ].filter(Boolean).join(path.delimiter)
    };
  }
}

function classifyServerError(message: string): string {
  if (message.includes("No module named 'mcp'")) {
    return "Missing Python dependency: mcp. Set Settings > Python path to the project venv, usually /Users/pi-in-185/OrchestAI/venv/bin/python, then run pip install -r requirements.txt if needed.";
  }
  if (message.includes("No module named 'openpyxl'")) {
    return "Missing Python dependency: openpyxl. Set Settings > Python path to the project venv, usually /Users/pi-in-185/OrchestAI/venv/bin/python, then run pip install -r requirements.txt if needed.";
  }
  if (message.includes("No module named 'fitz'")) {
    return "Missing Python dependency: PyMuPDF/fitz. Set Settings > Python path to the project venv, usually /Users/pi-in-185/OrchestAI/venv/bin/python, then run pip install -r requirements.txt if needed.";
  }
  if (message.includes("No module named 'faker'")) {
    return "Missing Python dependency: Faker. Set Settings > Python path to the project venv, usually /Users/pi-in-185/OrchestAI/venv/bin/python, then run pip install -r requirements.txt if needed.";
  }
  if (message.includes("API_KEY") || message.includes("api key")) {
    return "Missing API key for the selected LLM provider. Add it in Settings.";
  }
  return message;
}

function appendStderr(server: ManagedServer, message: string): void {
  const lines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  server.stderrTail.push(...lines);
  if (server.stderrTail.length > 12) {
    server.stderrTail.splice(0, server.stderrTail.length - 12);
  }
}

function withStderrTail(server: ManagedServer, message: string): string {
  if (!server.stderrTail.length) {
    return message;
  }
  return `${message}\n\nRecent stderr:\n${server.stderrTail.join("\n")}`;
}
