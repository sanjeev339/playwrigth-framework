import type { LogEntry } from "../shared/types";

const MAX_LOGS = 800;

export class AppLogger {
  private entries: LogEntry[] = [];

  info(source: string, message: string): void {
    this.push("info", source, message);
  }

  warn(source: string, message: string): void {
    this.push("warn", source, message);
  }

  error(source: string, message: string): void {
    this.push("error", source, message);
  }

  list(): LogEntry[] {
    return [...this.entries].reverse();
  }

  private push(level: LogEntry["level"], source: string, message: string): void {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: new Date().toISOString(),
      level,
      source,
      message: redactSecrets(message)
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_LOGS) {
      this.entries.splice(0, this.entries.length - MAX_LOGS);
    }
  }
}

export function redactSecrets(value: string): string {
  return value
    .replace(/(sk-[a-zA-Z0-9_-]{8})[a-zA-Z0-9_-]+/g, "$1…")
    .replace(/(AIza[a-zA-Z0-9_-]{6})[a-zA-Z0-9_-]+/g, "$1…")
    .replace(/([A-Z0-9_]*API_KEY["']?\s*[:=]\s*["']?)([^"',\s]+)/gi, "$1***");
}

export const logger = new AppLogger();
