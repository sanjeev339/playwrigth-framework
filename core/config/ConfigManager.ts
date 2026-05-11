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
    static readonly BASE_URL = jsonConfig.baseUrl || process.env.BASE_URL;
    static readonly USERNAME = jsonConfig.users?.admin?.username || process.env.USERNAME;
    static readonly PASSWORD = jsonConfig.users?.admin?.password || process.env.PASSWORD;
    static readonly TIMEOUT = jsonConfig.timeouts?.default || parseInt(process.env.TIMEOUT || '30000');

    static getEnvConfig() {
        return jsonConfig;
    }
}
