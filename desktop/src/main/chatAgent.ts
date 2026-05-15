import { END, START, StateGraph } from "@langchain/langgraph";
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  DesktopConfig,
  ToolInfo,
} from "../shared/types";
import type { McpManager } from "./mcpManager";
import type { SettingsStore } from "./settingsStore";
import { providerSafeName } from "./toolSchema";

interface ToolDecision {
  mode: "tool" | "answer";
  serverId?: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
  content?: string;
}

interface AgentGraphState {
  request?: ChatRequest;
  userMessage?: ChatMessage;
  tools?: ToolInfo[];
  config?: DesktopConfig;
  apiKey?: string;
  decision?: ToolDecision;
  toolResult?: string;
  emittedMessages?: ChatMessage[];
}

interface AgentGraph {
  invoke(input: Partial<AgentGraphState>): Promise<AgentGraphState>;
}

export class ChatAgent {
  private readonly graph: AgentGraph;

  constructor(
    private readonly settings: SettingsStore,
    private readonly mcpManager: McpManager,
  ) {
    this.graph = this.createGraph();
  }

  async send(request: ChatRequest): Promise<ChatResponse> {
    const result = await this.graph.invoke({ request });
    return {
      messages: result.emittedMessages || [
        makeMessage("user", request.message),
        makeMessage(
          "assistant",
          "The LangGraph agent finished without producing a response.",
        ),
      ],
    };
  }

  private createGraph(): AgentGraph {
    const graph = new StateGraph<AgentGraphState>({
      channels: {
        request: null,
        userMessage: null,
        tools: null,
        config: null,
        apiKey: null,
        decision: null,
        toolResult: null,
        emittedMessages: null,
      },
    });

    return graph
      .addNode("loadContext", async (state) => this.loadContext(state))
      .addNode("decide", async (state) => this.decide(state))
      .addNode("callTool", async (state) => this.callSelectedTool(state))
      .addNode("finalize", (state) => this.finalize(state))
      .addEdge(START, "loadContext")
      .addEdge("loadContext", "decide")
      .addConditionalEdges("decide", routeAfterDecision, {
        callTool: "callTool",
        finalize: "finalize",
      })
      .addEdge("callTool", "finalize")
      .addEdge("finalize", END)
      .compile() as unknown as AgentGraph;
  }

  private async loadContext(
    state: AgentGraphState,
  ): Promise<Partial<AgentGraphState>> {
    const request = requireRequest(state);
    const config = this.settings.getConfig();
    const tools = await this.mcpManager.listTools();
    const apiKey = this.settings.getSecret(
      config.apiKeyRefs[config.llmProvider],
    );
    return {
      userMessage: makeMessage("user", request.message),
      config,
      tools,
      apiKey,
    };
  }

  private async decide(
    state: AgentGraphState,
  ): Promise<Partial<AgentGraphState>> {
    const request = requireRequest(state);
    const tools = state.tools || [];
    const config = state.config || this.settings.getConfig();
    const apiKey = state.apiKey || "";

    const decision = apiKey
      ? await chooseWithLlm(
          request.message,
          request.history,
          tools,
          config,
          apiKey,
        )
      : chooseHeuristically(request.message, tools);

    return { decision };
  }

  private async callSelectedTool(
    state: AgentGraphState,
  ): Promise<Partial<AgentGraphState>> {
    const decision = state.decision;
    if (!decision?.serverId || !decision.toolName) {
      return {
        toolResult:
          "LangGraph selected tool mode but did not provide a valid MCP server/tool pair.",
      };
    }

    const result = await this.mcpManager.callTool({
      serverId: decision.serverId,
      toolName: decision.toolName,
      args: decision.arguments || {},
    });

    return { toolResult: result.content };
  }

  private finalize(state: AgentGraphState): Partial<AgentGraphState> {
    const request = requireRequest(state);
    const userMessage =
      state.userMessage || makeMessage("user", request.message);
    const decision = state.decision;

    if (decision?.mode === "tool") {
      const toolResult = state.toolResult || "No tool result was returned.";
      return {
        emittedMessages: [
          userMessage,
          makeMessage("tool", toolResult),
          makeMessage(
            "assistant",
            `LangGraph ran ${decision.toolName || "the selected MCP tool"}${decision.serverId ? ` on the ${decision.serverId} server` : ""} and attached the result above.`,
          ),
        ],
      };
    }

    return {
      emittedMessages: [
        userMessage,
        makeMessage(
          "assistant",
          decision?.content ||
            "LangGraph did not need a tool for this message. Use Full Lifecycle or Tool Catalog for deterministic MCP tool execution.",
        ),
      ],
    };
  }
}

function routeAfterDecision(state: AgentGraphState): "callTool" | "finalize" {
  const decision = state.decision;
  return decision?.mode === "tool" && decision.serverId && decision.toolName
    ? "callTool"
    : "finalize";
}

function requireRequest(state: AgentGraphState): ChatRequest {
  if (!state.request) {
    throw new Error("LangGraph chat state is missing the chat request.");
  }
  return state.request;
}

function makeMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

async function chooseWithLlm(
  message: string,
  history: ChatMessage[],
  tools: ToolInfo[],
  config: DesktopConfig,
  apiKey: string,
): Promise<ToolDecision> {
  const prompt = [
    "You are a LangGraph routing node for OrchestAI Desktop.",
    "Choose exactly one MCP tool if the user asks for QA artifact generation, Playwright/browser automation code, document ingestion, exports, reports, scenarios, coverage, or data.",
    "Otherwise answer directly.",
    "Return ONLY JSON with shape:",
    '{"mode":"tool","serverId":"workflow","toolName":"qa_workflow_full_lifecycle","arguments":{}}',
    'or {"mode":"answer","content":"..."}.',
    "",
    "Playwright generation rule:",
    "If the user gives only scenarios_combined.csv and test_data.json and wants to process test cases one by one, prefer list_playwright_artifact_scenarios first so the user can choose a scenarioId.",
    "If generate_playwright_with_llm is available and the user says the LLM should generate the Playwright code/script, prefer generate_playwright_with_llm over the deterministic generator.",
    "For generate_playwright_with_llm, pass prompt, optional artifact {scenariosCsvPath,testDataJsonPath,scenarioId}, optional baseUrl, featureName, testId, title, testData, loginBefore, provider/model, and options. Use dryRun=true unless the user explicitly says real/write/create files/not dry run.",
    "If the user asks to create Playwright automation from existing scenario/data artifact files, prefer generate_playwright_from_artifacts when it is available.",
    "For generate_playwright_from_artifacts, pass scenariosCsvPath, testDataJsonPath, scenarioId, optional baseUrl, optional featureName, and options. Use dryRun=true unless the user explicitly says to write/create files.",
    "If the user asks to create Playwright automation from free-form text, browser tests, page objects, specs, or test scripts, prefer the generate_playwright_test tool when it is available.",
    "For generate_playwright_test, convert the user's free-form test case into this argument shape:",
    '{"featureName":"Login","testId":"TC-001","title":"should login with valid credentials","description":"...","expectedResult":"...","testData":{"loginUrl":"https://...","username":"..."},"steps":[{"action":"goto","valueKey":"loginUrl"},{"action":"fill","target":"email input","locator":{"kind":"label","value":"Email"},"valueKey":"username"},{"action":"click","target":"login button","locator":{"kind":"role","role":"button","name":"Login"}},{"action":"expectVisible","target":"dashboard heading","locator":{"kind":"role","role":"heading","name":"Dashboard"}}],"options":{"dryRun":true,"overwrite":false,"updateFixtures":true}}',
    "Use dryRun=true unless the user explicitly says to write/create files.",
    "Prefer stable locators in this order: role, label, placeholder, testId, text. Use css only when no stable locator is provided. Never invent XPath.",
    "Put reusable values in testData and reference them with valueKey or expectedTextKey.",
    "",
    "Available tools:",
    tools
      .map(
        (tool) =>
          `- ${providerSafeName(tool)} => serverId=${tool.serverId}, toolName=${tool.name}, schema=${JSON.stringify(tool.inputSchema).slice(0, 2500)}`,
      )
      .join("\n"),
    "",
    "Recent history:",
    history
      .slice(-6)
      .map((item) => `${item.role}: ${item.content.slice(0, 1000)}`)
      .join("\n"),
    "",
    `User: ${message}`,
  ].join("\n");

  const raw = await callProvider(config.llmProvider, apiKey, prompt);
  const decision = parseDecision(raw);
  return decision
    ? normalizeToolDecision(decision, tools)
    : chooseHeuristically(message, tools);
}

function chooseHeuristically(message: string, tools: ToolInfo[]): ToolDecision {
  const lower = message.toLowerCase();
  const playwright = findTool(tools, "generate_playwright_test");
  if (playwright && isPlaywrightGenerationRequest(lower)) {
    return {
      mode: "answer",
      content: [
        "I found the Playwright Generator MCP tool, but free-form Playwright generation needs an LLM API key configured in Settings.",
        "Add a Gemini, OpenAI, or Anthropic key, then ask again with the manual test case and test data.",
        "For deterministic execution without an LLM, use Tool Catalog and call generate_playwright_test with structured JSON.",
      ].join("\n"),
    };
  }

  const workflow = tools.find(
    (tool) => tool.name === "qa_workflow_full_lifecycle",
  );
  if (
    workflow &&
    (lower.includes("full lifecycle") ||
      lower.includes("generate all") ||
      lower.includes("strategy") ||
      lower.includes("scenarios"))
  ) {
    return {
      mode: "tool",
      serverId: workflow.serverId,
      toolName: workflow.name,
      arguments: {
        source: message,
        record_count: 10,
        table_name: "test_data",
        auto_patch: false,
      },
    };
  }
  const dataTool = tools.find((tool) => tool.name === "qa_data_from_schema");
  if (dataTool && lower.includes("test data")) {
    return {
      mode: "tool",
      serverId: dataTool.serverId,
      toolName: dataTool.name,
      arguments: {
        schema_description: message,
        record_count: 10,
        output_format: "json",
        table_name: "test_data",
      },
    };
  }
  return {
    mode: "answer",
    content:
      "LangGraph can route QA and Playwright generation requests through MCP tools. For deterministic execution, use Full Lifecycle, Playwright Generator, or Tool Catalog for direct tool calls.",
  };
}

function parseDecision(raw: string): ToolDecision | undefined {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as ToolDecision;
    if (parsed.mode === "tool" || parsed.mode === "answer") return parsed;
  } catch {
    return undefined;
  }
  return undefined;
}

function normalizeToolDecision(
  decision: ToolDecision,
  tools: ToolInfo[],
): ToolDecision {
  if (decision.mode !== "tool" || !decision.toolName) {
    return decision;
  }

  const matchedTool = tools.find(
    (tool) =>
      (decision.serverId ? tool.serverId === decision.serverId : true) &&
      (tool.name === decision.toolName ||
        providerSafeName(tool) === decision.toolName),
  );

  if (!matchedTool) {
    return decision;
  }

  return {
    ...decision,
    serverId: matchedTool.serverId,
    toolName: matchedTool.name,
    arguments: decision.arguments || {},
  };
}

function findTool(tools: ToolInfo[], name: string): ToolInfo | undefined {
  return tools.find((tool) => tool.name === name);
}

function isPlaywrightGenerationRequest(lowerMessage: string): boolean {
  return [
    "playwright",
    "playwrite",
    "automation code",
    "page object",
    "generate test code",
    "test script",
    "browser test",
  ].some((phrase) => lowerMessage.includes(phrase));
}

async function callProvider(
  provider: DesktopConfig["llmProvider"],
  apiKey: string,
  prompt: string,
): Promise<string> {
  if (provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
      }),
    });
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content || "";
  }

  if (provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-latest",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = (await response.json()) as {
      content?: Array<{ text?: string }>;
    };
    return data.content?.[0]?.text || "";
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0 },
      }),
    },
  );
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}
