import { describe, expect, it } from "vitest";
import { redactSecrets } from "./logger";

describe("redactSecrets", () => {
  it("redacts provider API key style values", () => {
    expect(redactSecrets("OPENAI_API_KEY=sk-proj-secretvalue")).toBe("OPENAI_API_KEY=***");
    expect(redactSecrets("GEMINI_API_KEY: AIzaabcdefghi")).toBe("GEMINI_API_KEY: ***");
  });
});
