import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { createDefaultConfig, normalizeConfig, refreshServerDefaults } from "./config";
import { SecretsStore } from "./secretsStore";
import type { DesktopConfig, SettingsSnapshot, SettingsUpdate } from "../shared/types";

export class SettingsStore {
  private readonly filePath: string;
  private readonly appPath: string;
  private readonly secrets: SecretsStore;

  constructor(userDataPath = app.getPath("userData"), appPath = app.getAppPath()) {
    this.filePath = path.join(userDataPath, "orchestai-desktop-config.json");
    this.appPath = appPath;
    this.secrets = new SecretsStore(userDataPath);
  }

  getSnapshot(): SettingsSnapshot {
    const config = this.getConfig();
    return {
      config,
      maskedApiKeys: {
        gemini: this.secrets.mask(config.apiKeyRefs.gemini),
        openai: this.secrets.mask(config.apiKeyRefs.openai),
        anthropic: this.secrets.mask(config.apiKeyRefs.anthropic),
        figma: this.secrets.mask(config.apiKeyRefs.figma)
      }
    };
  }

  getConfig(): DesktopConfig {
    let parsed: DesktopConfig | undefined;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as DesktopConfig;
    } catch {
      parsed = createDefaultConfig(this.appPath);
    }
    return normalizeConfig(parsed, this.appPath);
  }

  update(update: SettingsUpdate): SettingsSnapshot {
    const next = refreshServerDefaults(normalizeConfig(update.config, this.appPath));
    for (const [key, value] of Object.entries(update.apiKeys || {})) {
      const ref = next.apiKeyRefs[key as keyof typeof next.apiKeyRefs];
      if (ref && typeof value === "string") {
        this.secrets.set(ref, value);
      }
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(next, null, 2));
    return this.getSnapshot();
  }

  getSecret(ref?: string): string {
    return this.secrets.get(ref);
  }
}
