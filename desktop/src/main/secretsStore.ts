import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";

type SecretFile = Record<string, string>;

export class SecretsStore {
  private readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, "orchestai-secrets.json");
  }

  get(ref?: string): string {
    if (!ref) return "";
    const data = this.read();
    const encrypted = data[ref];
    if (!encrypted) return "";
    try {
      const buffer = Buffer.from(encrypted, "base64");
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(buffer);
      }
      return buffer.toString("utf8");
    } catch {
      return "";
    }
  }

  set(ref: string, value: string): void {
    const data = this.read();
    if (!value) {
      delete data[ref];
    } else {
      const buffer = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(value)
        : Buffer.from(value, "utf8");
      data[ref] = buffer.toString("base64");
    }
    this.write(data);
  }

  mask(ref?: string): string {
    const secret = this.get(ref);
    if (!secret) return "";
    if (secret.length <= 8) return "********";
    return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
  }

  private read(): SecretFile {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8")) as SecretFile;
    } catch {
      return {};
    }
  }

  private write(data: SecretFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }
}
