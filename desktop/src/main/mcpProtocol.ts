export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  method?: string;
  params?: Record<string, unknown>;
}

export function encodeMcpMessage(message: JsonRpcRequest | JsonRpcNotification): Buffer {
  return Buffer.from(`${JSON.stringify(message)}\n`, "utf8");
}

export class McpFrameParser {
  private buffer = "";

  push(chunk: Buffer): JsonRpcResponse[] {
    this.buffer += chunk.toString("utf8");
    const messages: JsonRpcResponse[] = [];

    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex === -1) break;

      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) continue;

      try {
        messages.push(JSON.parse(line) as JsonRpcResponse);
      } catch {
        messages.push({
          jsonrpc: "2.0",
          error: {
            code: -32700,
            message: "Failed to parse MCP JSON-RPC frame."
          }
        });
      }
    }

    return messages;
  }
}

export function extractToolTextContent(raw: unknown): string {
  const result = raw as { content?: Array<{ type?: string; text?: string }> };
  if (Array.isArray(result?.content)) {
    return result.content
      .map((item) => {
        if (item.type === "text" && typeof item.text === "string") return item.text;
        return JSON.stringify(item);
      })
      .join("\n");
  }
  return typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
}
