import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config();

const ENV = process.env.ENV;
const CONFIG_PATH = path.resolve(__dirname, `../../config/${ENV}.json`);

let jsonConfig: any = {};
try {
    if (fs.existsSync(CONFIG_PATH)) {
        jsonConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
} catch (error) {
    console.warn(`Failed to load config file at ${CONFIG_PATH}. Falling back to environment variables.`);
}

export class ConfigManager {
    static readonly ENV = ENV;
    static readonly BASE_URL = process.env.BASE_URL || jsonConfig.baseUrl;
    static readonly USERNAME = process.env.USERNAME || jsonConfig.users?.admin?.username;
    static readonly PASSWORD = process.env.PASSWORD || jsonConfig.users?.admin?.password;
    static readonly TIMEOUT = parseInt(process.env.TIMEOUT || '', 10) || jsonConfig.timeouts?.default || 30000;

    static getEnvConfig() {
        return jsonConfig;
    }
}
