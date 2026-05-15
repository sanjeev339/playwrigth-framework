import { describe, expect, it } from "vitest";
import { encodeMcpMessage, extractToolTextContent, McpFrameParser } from "./mcpProtocol";

describe("MCP protocol framing", () => {
  it("encodes and parses newline-delimited JSON-RPC frames", () => {
    const encoded = encodeMcpMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {}
    });
    const parser = new McpFrameParser();
    const messages = parser.push(encoded);
    expect(messages).toEqual([{ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }]);
  });

  it("parses frames split across chunks", () => {
    const encoded = encodeMcpMessage({ jsonrpc: "2.0", id: 2, method: "initialize" });
    const parser = new McpFrameParser();
    expect(parser.push(encoded.subarray(0, 10))).toEqual([]);
    expect(parser.push(encoded.subarray(10))).toEqual([{ jsonrpc: "2.0", id: 2, method: "initialize" }]);
  });

  it("extracts text from MCP tool content", () => {
    expect(extractToolTextContent({ content: [{ type: "text", text: "hello" }] })).toBe("hello");
  });
});
