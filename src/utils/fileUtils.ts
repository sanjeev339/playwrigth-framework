import path from 'node:path';
import fs from 'fs-extra';

export const projectRoot = process.cwd();

export function resolveFromRoot(...segments: string[]): string {
  return path.resolve(projectRoot, ...segments);
}

export async function ensureParentDir(filePath: string): Promise<void> {
  await fs.ensureDir(path.dirname(filePath));
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await ensureParentDir(filePath);
  await fs.writeJson(filePath, data, { spaces: 2 });
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  return fs.readJson(filePath) as Promise<T>;
}

export async function writeTextFile(filePath: string, data: string): Promise<void> {
  await ensureParentDir(filePath);
  await fs.writeFile(filePath, data, 'utf8');
}

export async function readTextFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf8');
}

export async function listFiles(dir: string, extension?: string): Promise<string[]> {
  if (!(await fs.pathExists(dir))) {
    return [];
  }

  const entries = await fs.readdir(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = await fs.stat(fullPath);

    if (stat.isDirectory()) {
      files.push(...(await listFiles(fullPath, extension)));
      continue;
    }

    if (!extension || fullPath.endsWith(extension)) {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

export function toSafeFileName(value: string): string {
  return value
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function slugify(value: string, fallback = 'state'): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

  return slug || fallback;
}

export function truncate(value: string, maxLength = 8000): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n...[truncated ${value.length - maxLength} characters]`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
