export class Logger {
    static info(message: string) {
        console.log(`[INFO] [${new Date().toISOString()}] ${message}`);
    }

    static error(message: string, error?: any) {
        console.error(`[ERROR] [${new Date().toISOString()}] ${message}`, error || '');
    }

    static warn(message: string) {
        console.warn(`[WARN] [${new Date().toISOString()}] ${message}`);
    }

    static debug(message: string) {
        if (process.env.DEBUG) {
            console.log(`[DEBUG] [${new Date().toISOString()}] ${message}`);
        }
    }
}
