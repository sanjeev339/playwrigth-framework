import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateArtifactPath } from "./artifacts";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("artifact path validation", () => {
  it("allows supported files inside the output directory", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestai-artifacts-"));
    const artifact = path.join(tempDir, "report.md");
    fs.writeFileSync(artifact, "ok");

    expect(validateArtifactPath(artifact, tempDir)).toBe(fs.realpathSync(artifact));
  });

  it("blocks files outside the output directory", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestai-artifacts-"));
    const outside = path.join(os.tmpdir(), `outside-${Date.now()}.md`);
    fs.writeFileSync(outside, "nope");

    try {
      expect(() => validateArtifactPath(outside, tempDir!)).toThrow(/outside the configured output directory/);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it("blocks unsupported extensions", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestai-artifacts-"));
    const artifact = path.join(tempDir, "script.sh");
    fs.writeFileSync(artifact, "echo nope");

    expect(() => validateArtifactPath(artifact, tempDir!)).toThrow(/unsupported extension/);
  });
});
