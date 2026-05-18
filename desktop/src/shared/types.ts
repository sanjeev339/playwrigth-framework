export type LlmProvider = "gemini" | "openai" | "anthropic";

export type ServerHealth = "stopped" | "starting" | "ready" | "failed";

export interface ServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

export interface ApiKeyRefs {
  gemini?: string;
  openai?: string;
  anthropic?: string;
  figma?: string;
}

export interface DesktopConfig {
  projectPath: string;
  pythonPath: string;
  outputDir: string;
  llmProvider: LlmProvider;
  apiKeyRefs: ApiKeyRefs;
  servers: ServerConfig[];
}

export interface SettingsSnapshot {
  config: DesktopConfig;
  maskedApiKeys: Record<string, string>;
}

export interface SettingsUpdate {
  config: DesktopConfig;
  apiKeys?: Partial<Record<keyof ApiKeyRefs, string>>;
}

export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
  serverName: string;
}

export interface ToolCallRequest {
  serverId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolCallResult {
  serverId: string;
  toolName: string;
  content: string;
  raw: unknown;
}

export interface ServerStatus {
  id: string;
  name: string;
  health: ServerHealth;
  toolCount: number;
  lastError?: string;
  pid?: number;
}

export interface DiagnosticItem {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  remediation?: string;
}

export interface ArtifactInfo {
  name: string;
  path: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
}

export interface ChatRequest {
  message: string;
  history: ChatMessage[];
}

export interface ChatResponse {
  messages: ChatMessage[];
}

export interface WorkflowRequest {
  source: string;
  baseUrl?: string;
  outputPath?: string;
  recordCount: number;
  tableName: string;
  autoPatch: boolean;
}

export interface ArtifactLifecycleRequest {
  scenariosCsvPath: string;
  testDataJsonPath: string;
  baseUrl?: string;
  outputDir?: string;
  provider?: LlmProvider;
  model?: string;
  env: string;
  headed: boolean;
  automationSuitability: "Yes" | "No" | "Partial" | "All";
  maxRepairAttempts: number;
  stopOnFailure: boolean;
}

export interface LogEntry {
  id: string;
  createdAt: string;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
}
