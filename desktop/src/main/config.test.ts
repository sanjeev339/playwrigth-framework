import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import {
  createDefaultConfig,
  createDefaultServers,
  normalizeConfig,
  refreshServerDefaults,
  resolvePythonPath,
} from "./config";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: (target: string) =>
        target.includes("OrchestAI") || target.endsWith("python"),
    },
    existsSync: (target: string) =>
      target.includes("OrchestAI") || target.endsWith("python"),
  };
});

describe("desktop config", () => {
  it("creates modular server defaults", () => {
    const servers = createDefaultServers(
      "/tmp/OrchestAI",
      "/tmp/OrchestAI/venv/bin/python",
      "gemini",
    );
    expect(servers.map((server) => server.id)).toEqual([
      "planner",
      "data",
      "workflow",
      "utils",
      "compliance",
      "playwright",
    ]);
    expect(servers[0]?.args[0]).toContain(
      path.join("qa_orchestrator", "planner_server.py"),
    );
    expect(servers[5]).toMatchObject({
      id: "playwright",
      command: "corepack",
      args: ["pnpm", "mcp:server"],
    });
    expect(
      servers
        .filter((server) => server.id !== "playwright")
        .every((server) => server.env.LLM_PROVIDER === "gemini"),
    ).toBe(true);
  });

  it("normalizes missing API key refs and servers", () => {
    const config = normalizeConfig(
      {
        ...createDefaultConfig("/tmp/OrchestAI", "/tmp/OrchestAI"),
        apiKeyRefs: {},
        servers: [],
      },
      "/tmp/OrchestAI",
    );
    expect(config.apiKeyRefs.gemini).toBe("gemini");
    expect(config.servers).toHaveLength(6);
  });

  it("refreshes server paths when runtime settings change", () => {
    const config = createDefaultConfig("/tmp/OrchestAI", "/tmp/OrchestAI");
    const refreshed = refreshServerDefaults({
      ...config,
      pythonPath: "/custom/python",
      llmProvider: "openai",
    });
    expect(refreshed.servers[0]?.command).toBe("/custom/python");
    expect(refreshed.servers[0]?.env.LLM_PROVIDER).toBe("openai");
    expect(
      refreshed.servers.find((server) => server.id === "playwright")?.command,
    ).toBe("corepack");
  });

  it("prefers the project venv when saved python path is generic", () => {
    expect(resolvePythonPath("python3", "/tmp/OrchestAI")).toBe(
      "/tmp/OrchestAI/venv/bin/python",
    );
  });
});
