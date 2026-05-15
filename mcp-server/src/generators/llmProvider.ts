export type LlmProvider = "gemini" | "openai" | "anthropic";

export async function callLlmProvider(
  provider: LlmProvider,
  prompt: string,
  model?: string,
): Promise<string> {
  if (provider === "openai") {
    return callOpenAi(prompt, model || "gpt-4o-mini");
  }

  if (provider === "anthropic") {
    return callAnthropic(prompt, model || "claude-3-5-sonnet-latest");
  }

  return callGemini(prompt, model || "gemini-2.5-flash");
}

export function resolveLlmProvider(provider?: string): LlmProvider {
  const normalized = (provider || process.env.LLM_PROVIDER || "gemini")
    .toLowerCase()
    .trim();
  if (
    normalized === "openai" ||
    normalized === "anthropic" ||
    normalized === "gemini"
  ) {
    return normalized;
  }
  return "gemini";
}

function requireApiKey(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Add the API key in Desktop Settings and restart the Playwright MCP server.`,
    );
  }
  return value;
}

async function callOpenAi(prompt: string, model: string): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireApiKey("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 12000,
      response_format: { type: "json_object" },
    }),
  });
  const data = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI request failed.`);
  }
  return data.choices?.[0]?.message?.content || "";
}

async function callAnthropic(prompt: string, model: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": requireApiKey("ANTHROPIC_API_KEY"),
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
    }),
  });
  const data = (await response.json()) as {
    error?: { message?: string };
    content?: Array<{ text?: string }>;
  };
  if (!response.ok) {
    throw new Error(data.error?.message || `Anthropic request failed.`);
  }
  return data.content?.[0]?.text || "";
}

async function callGemini(prompt: string, model: string): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(requireApiKey("GEMINI_API_KEY"))}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1 },
      }),
    },
  );
  const data = (await response.json()) as {
    error?: { message?: string };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  if (!response.ok) {
    throw new Error(data.error?.message || `Gemini request failed.`);
  }
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}
