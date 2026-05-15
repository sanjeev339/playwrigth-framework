import { describe, expect, it } from "vitest";
import { ChatAgent } from "./chatAgent";
import type {
  ChatRequest,
  DesktopConfig,
  ServerStatus,
  ToolCallRequest,
  ToolCallResult,
  ToolInfo,
} from "../shared/types";

class FakeSettings {
  getConfig(): DesktopConfig {
    return {
      projectPath: "/tmp/OrchestAI",
      pythonPath: "/tmp/OrchestAI/venv/bin/python",
      outputDir: "/tmp/OrchestAI/generated_output",
      llmProvider: "gemini",
      apiKeyRefs: {
        gemini: "gemini",
        openai: "openai",
        anthropic: "anthropic",
        figma: "figma",
      },
      servers: [],
    };
  }

  getSecret(): string {
    return "";
  }
}

class FakeMcpManager {
  async listTools(): Promise<ToolInfo[]> {
    return [
      {
        serverId: "workflow",
        serverName: "Workflow",
        name: "qa_workflow_full_lifecycle",
        description: "Run full lifecycle",
        inputSchema: {},
      },
      {
        serverId: "playwright",
        serverName: "Playwright Generator",
        name: "generate_playwright_test",
        description: "Generate Playwright framework code",
        inputSchema: {},
      },
    ];
  }

  async callTool(request: ToolCallRequest): Promise<ToolCallResult> {
    return {
      serverId: request.serverId,
      toolName: request.toolName,
      raw: {},
      content: "workflow result",
    };
  }

  statuses(): ServerStatus[] {
    return [];
  }
}

describe("ChatAgent LangGraph", () => {
  it("routes a lifecycle request through the MCP tool node", async () => {
    const agent = new ChatAgent(
      new FakeSettings() as never,
      new FakeMcpManager() as never,
    );
    const request: ChatRequest = {
      message: "generate full lifecycle scenarios for login",
      history: [],
    };

    const response = await agent.send(request);

    expect(response.messages.map((message) => message.role)).toEqual([
      "user",
      "tool",
      "assistant",
    ]);
    expect(response.messages[1]?.content).toBe("workflow result");
    expect(response.messages[2]?.content).toContain(
      "LangGraph ran qa_workflow_full_lifecycle",
    );
  });

  it("asks for an LLM key before free-form Playwright generation", async () => {
    const agent = new ChatAgent(
      new FakeSettings() as never,
      new FakeMcpManager() as never,
    );
    const request: ChatRequest = {
      message: "generate playwright automation code for invalid login",
      history: [],
    };

    const response = await agent.send(request);

    expect(response.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(response.messages[1]?.content).toContain("needs an LLM API key");
  });
});
