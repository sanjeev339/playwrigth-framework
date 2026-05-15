import { describe, expect, it } from "vitest";
import { providerSafeName, toAnthropicTool, toOpenAiTool } from "./toolSchema";
import type { ToolInfo } from "../shared/types";

const tool: ToolInfo = {
  serverId: "workflow",
  serverName: "Workflow",
  name: "qa_workflow_full_lifecycle",
  description: "Run lifecycle",
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string" }
    }
  }
};

describe("tool schema conversion", () => {
  it("creates provider-safe names", () => {
    expect(providerSafeName(tool)).toBe("workflow_qa_workflow_full_lifecycle");
  });

  it("converts to OpenAI and Anthropic tool shapes", () => {
    expect(toOpenAiTool(tool)).toMatchObject({ type: "function" });
    expect(toAnthropicTool(tool)).toMatchObject({ name: "workflow_qa_workflow_full_lifecycle" });
  });
});
