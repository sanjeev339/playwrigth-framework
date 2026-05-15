import fs from "node:fs";
import path from "node:path";
import { shell } from "electron";
import type { ArtifactInfo } from "../shared/types";

const EXTENSIONS = new Set([".md", ".yml", ".yaml", ".json", ".csv", ".xlsx"]);
const MAX_DEPTH = 4;

export function listArtifacts(outputDir: string): ArtifactInfo[] {
  if (!fs.existsSync(outputDir)) return [];
  const files: ArtifactInfo[] = [];
  walk(outputDir, outputDir, files, 0);
  return files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export async function openArtifact(filePath: string, outputDir: string): Promise<string> {
  const safePath = validateArtifactPath(filePath, outputDir);
  const result = await shell.openPath(safePath);
  return result || "opened";
}

export function validateArtifactPath(filePath: string, outputDir: string): string {
  const root = fs.realpathSync(outputDir);
  const target = fs.realpathSync(filePath);
  const relative = path.relative(root, target);
  const extension = path.extname(target).toLowerCase();

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Blocked artifact open request outside the configured output directory.");
  }
  if (!EXTENSIONS.has(extension)) {
    throw new Error(`Blocked artifact open request for unsupported extension '${extension || "(none)"}'.`);
  }
  if (!fs.statSync(target).isFile()) {
    throw new Error("Blocked artifact open request because the target is not a file.");
  }
  return target;
}

function walk(root: string, current: string, files: ArtifactInfo[], depth: number): void {
  if (depth > MAX_DEPTH) return;
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      walk(root, fullPath, files, depth + 1);
      continue;
    }
    const extension = path.extname(entry.name).toLowerCase();
    if (!EXTENSIONS.has(extension)) continue;
    const stat = fs.statSync(fullPath);
    files.push({
      name: path.relative(root, fullPath),
      path: fullPath,
      extension,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString()
    });
  }
}
