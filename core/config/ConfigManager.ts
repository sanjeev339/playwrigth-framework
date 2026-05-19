import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config();

const ENV = process.env.ENV;
const CONFIG_PATH = path.resolve(__dirname, `../../config/${ENV}.json`);

interface JsonConfig {
    env?: string;
    baseUrl?: string;
    timeouts?: { default?: number; navigation?: number };
    retry?: { test?: number; action?: number };
    users?: {
        admin?: { username?: string; password?: string };
    };
}

let jsonConfig: JsonConfig = {};
try {
    if (fs.existsSync(CONFIG_PATH)) {
        jsonConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as JsonConfig;
    }
} catch (error) {
    console.warn(`Failed to load config file at ${CONFIG_PATH}. Falling back to environment variables.`);
}

// Resolve credentials: prefer .env values over JSON config so secrets stay out of committed files.
const resolvedUsername = process.env.USERNAME || jsonConfig.users?.admin?.username;
const resolvedPassword = process.env.PASSWORD || jsonConfig.users?.admin?.password;
const resolvedBaseUrl  = jsonConfig.baseUrl    || process.env.BASE_URL;

// ── Startup guard ──────────────────────────────────────────────────────────────
function requireConfig(value: string | undefined, key: string): string {
    if (value) return value;
    throw new Error(
        `[ConfigManager] ${key} is not configured.\n` +
        '  • Set ENV=dev (or qa) so the matching config/<env>.json is loaded, OR\n' +
        '  • Set the value directly in your .env file.\n' +
        '  See .env.example for the full list of required variables.'
    );
}

export class ConfigManager {
    static readonly ENV      = requireConfig(ENV, 'ENV');
    static readonly BASE_URL = requireConfig(resolvedBaseUrl, 'BASE_URL');
    static readonly USERNAME = requireConfig(resolvedUsername, 'USERNAME');
    static readonly PASSWORD = requireConfig(resolvedPassword, 'PASSWORD');
    static readonly TIMEOUT  = jsonConfig.timeouts?.default || parseInt(process.env.TIMEOUT || '30000');

    static getEnvConfig(): JsonConfig {
        return jsonConfig;
    }
}
