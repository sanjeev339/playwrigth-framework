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
  const existsSync = (target: string) => {
    if (target.includes("playwrigth-framework")) {
      return (
        target.endsWith("playwright.config.ts") ||
        target.endsWith("mcp-server") ||
        target.endsWith("python")
      );
    }
    return target.includes("OrchestAI") || target.endsWith("python");
  };
  return {
    ...actual,
    default: {
      ...actual,
      existsSync,
    },
    existsSync,
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

  it("disables stale Python servers when the project is only Playwright", () => {
    const config = normalizeConfig(
      {
        ...createDefaultConfig(
          "/tmp/playwrigth-framework",
          "/tmp/playwrigth-framework",
        ),
        projectPath: "/tmp/playwrigth-framework",
        pythonPath: "/tmp/playwrigth-framework/node_modules",
        servers: createDefaultServers(
          "/tmp/OrchestAI",
          "/tmp/playwrigth-framework/node_modules",
          "openai",
        ).map((server) => ({ ...server, enabled: true })),
      },
      "/tmp/playwrigth-framework",
    );

    expect(
      config.servers
        .filter((server) => server.id !== "playwright")
        .every((server) => !server.enabled),
    ).toBe(true);
    expect(config.servers.find((server) => server.id === "playwright")).toMatchObject({
      enabled: true,
      command: "corepack",
    });
  });
});
