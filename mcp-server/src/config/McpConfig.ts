import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// Ensure environment variables are loaded from .env if present
dotenv.config();

const ENV = process.env.ENV || "dev";
const CONFIG_PATH = path.resolve(__dirname, `../../../config/${ENV}.json`);

export interface McpLlmConfig {
  provider: "gemini" | "openai" | "anthropic";
  geminiModel: string;
  openAiModel: string;
  anthropicModel: string;
  temperature: number;
  openAiMaxTokens: number;
  anthropicMaxTokens: number;
}

export interface McpDiscoveryConfig {
  userListApiPath: string;
  userListPageSize: number;
  userListMaxPages: number;
  userType: string;
  moduleMatchRegex: string;
  opensAddUserFormRegex: string;
  dropdownPanelSelectors: string[];
  dropdownOptionSelectors: string;
}

export interface McpLocatorFallbackEntry {
  matchKeywords: string[];
  candidates: string[];
}

export interface McpConfig {
  llm: McpLlmConfig;
  discovery: McpDiscoveryConfig;
  locatorFallbacks: McpLocatorFallbackEntry[];
}

// Default fallback configuration (used if mcp key is missing in config/<env>.json)
const defaultMcpConfig: McpConfig = {
  llm: {
    provider: "gemini",
    geminiModel: "gemini-2.5-flash",
    openAiModel: "gpt-4.1-mini",
    anthropicModel: "claude-3-5-sonnet-latest",
    temperature: 0.1,
    openAiMaxTokens: 12000,
    anthropicMaxTokens: 8000,
  },
  discovery: {
    userListApiPath: "/robolab/api/v1/user/list",
    userListPageSize: 100,
    userListMaxPages: 50,
    userType: "Backoffice",
    moduleMatchRegex: "\\btc-um\\b|\\buser\\s+management\\b",
    opensAddUserFormRegex: "\\b(add\\s+user|internal\\s+user|first\\s+name|last\\s+name|email\\s+address|unique\\s+user\\s+email|duplicate|already\\s+exists)\\b",
    dropdownPanelSelectors: [
      ".p-multiselect-panel",
      ".p-dropdown-panel",
      ".p-select-panel",
      '[role="listbox"]'
    ],
    dropdownOptionSelectors: "li, [role='option'], [role='checkbox'], label, .p-multiselect-item",
  },
  locatorFallbacks: [],
};

let rawConfig: any = {};
try {
  if (fs.existsSync(CONFIG_PATH)) {
    rawConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  }
} catch (error) {
  console.warn(
    `[McpConfig] Failed to load config file at ${CONFIG_PATH}. Using defaults.`
  );
}

const mcpJson = rawConfig.mcp || {};

// Merge JSON configs with defaults, then apply environment variable overrides
export const McpConfig: McpConfig = {
  llm: {
    provider: (process.env.MCP_LLM_PROVIDER ||
      mcpJson.llm?.provider ||
      defaultMcpConfig.llm.provider) as "gemini" | "openai" | "anthropic",
    geminiModel:
      process.env.MCP_GEMINI_MODEL ||
      mcpJson.llm?.geminiModel ||
      defaultMcpConfig.llm.geminiModel,
    openAiModel:
      process.env.MCP_OPENAI_MODEL ||
      mcpJson.llm?.openAiModel ||
      defaultMcpConfig.llm.openAiModel,
    anthropicModel:
      process.env.MCP_ANTHROPIC_MODEL ||
      mcpJson.llm?.anthropicModel ||
      defaultMcpConfig.llm.anthropicModel,
    temperature: process.env.MCP_LLM_TEMPERATURE
      ? parseFloat(process.env.MCP_LLM_TEMPERATURE)
      : mcpJson.llm?.temperature !== undefined
      ? mcpJson.llm.temperature
      : defaultMcpConfig.llm.temperature,
    openAiMaxTokens: process.env.MCP_OPENAI_MAX_TOKENS
      ? parseInt(process.env.MCP_OPENAI_MAX_TOKENS)
      : mcpJson.llm?.openAiMaxTokens !== undefined
      ? mcpJson.llm.openAiMaxTokens
      : defaultMcpConfig.llm.openAiMaxTokens,
    anthropicMaxTokens: process.env.MCP_ANTHROPIC_MAX_TOKENS
      ? parseInt(process.env.MCP_ANTHROPIC_MAX_TOKENS)
      : mcpJson.llm?.anthropicMaxTokens !== undefined
      ? mcpJson.llm.anthropicMaxTokens
      : defaultMcpConfig.llm.anthropicMaxTokens,
  },
  discovery: {
    userListApiPath:
      process.env.MCP_DISCOVERY_USER_LIST_API_PATH ||
      mcpJson.discovery?.userListApiPath ||
      defaultMcpConfig.discovery.userListApiPath,
    userListPageSize: process.env.MCP_DISCOVERY_USER_LIST_PAGE_SIZE
      ? parseInt(process.env.MCP_DISCOVERY_USER_LIST_PAGE_SIZE)
      : mcpJson.discovery?.userListPageSize !== undefined
      ? mcpJson.discovery.userListPageSize
      : defaultMcpConfig.discovery.userListPageSize,
    userListMaxPages: process.env.MCP_DISCOVERY_USER_LIST_MAX_PAGES
      ? parseInt(process.env.MCP_DISCOVERY_USER_LIST_MAX_PAGES)
      : mcpJson.discovery?.userListMaxPages !== undefined
      ? mcpJson.discovery.userListMaxPages
      : defaultMcpConfig.discovery.userListMaxPages,
    userType:
      process.env.MCP_DISCOVERY_USER_TYPE ||
      mcpJson.discovery?.userType ||
      defaultMcpConfig.discovery.userType,
    moduleMatchRegex:
      mcpJson.discovery?.moduleMatchRegex ||
      defaultMcpConfig.discovery.moduleMatchRegex,
    opensAddUserFormRegex:
      mcpJson.discovery?.opensAddUserFormRegex ||
      defaultMcpConfig.discovery.opensAddUserFormRegex,
    dropdownPanelSelectors:
      mcpJson.discovery?.dropdownPanelSelectors ||
      defaultMcpConfig.discovery.dropdownPanelSelectors,
    dropdownOptionSelectors:
      mcpJson.discovery?.dropdownOptionSelectors ||
      defaultMcpConfig.discovery.dropdownOptionSelectors,
  },
  locatorFallbacks: mcpJson.locatorFallbacks || defaultMcpConfig.locatorFallbacks,
};
