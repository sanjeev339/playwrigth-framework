import type { ToolInfo } from "../shared/types";

export type ProviderTool =
  | { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }
  | { name: string; description: string; input_schema: Record<string, unknown> }
  | { functionDeclarations: Array<{ name: string; description: string; parameters: Record<string, unknown> }> };

export function toOpenAiTool(tool: ToolInfo): ProviderTool {
  return {
    type: "function",
    function: {
      name: providerSafeName(tool),
      description: describeTool(tool),
      parameters: schemaOrObject(tool.inputSchema)
    }
  };
}

export function toAnthropicTool(tool: ToolInfo): ProviderTool {
  return {
    name: providerSafeName(tool),
    description: describeTool(tool),
    input_schema: schemaOrObject(tool.inputSchema)
  };
}

export function toGeminiTool(tool: ToolInfo): ProviderTool {
  return {
    functionDeclarations: [
      {
        name: providerSafeName(tool),
        description: describeTool(tool),
        parameters: schemaOrObject(tool.inputSchema)
      }
    ]
  };
}

export function providerSafeName(tool: ToolInfo): string {
  return `${tool.serverId}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

export function describeTool(tool: ToolInfo): string {
  return `[${tool.serverName}] ${tool.description || tool.name}`;
}

function schemaOrObject(schema: Record<string, unknown>): Record<string, unknown> {
  return Object.keys(schema || {}).length
    ? schema
    : {
        type: "object",
        properties: {},
        additionalProperties: true
      };
}
