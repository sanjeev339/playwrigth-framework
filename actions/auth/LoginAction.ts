import { Page } from '@playwright/test';
import { LoginPage } from '../../page_objects/auth/LoginPage';
import { ConfigManager } from '../../core/config/ConfigManager';
import { Logger } from '../../core/logger/Logger';

export class LoginAction {
    private readonly loginPage: LoginPage;

    constructor(page: Page) {
        this.loginPage = new LoginPage(page);
    }

    async login(
        username = ConfigManager.USERNAME,
        password = ConfigManager.PASSWORD,
    ): Promise<void> {
        Logger.info(`Performing login for user: ${username}`);
        await this.loginPage.loginFlow(username, password);
    }

    async loginAndWaitForLoad(
        username = ConfigManager.USERNAME,
        password = ConfigManager.PASSWORD,
    ): Promise<void> {
        Logger.info(`Performing login with post-load wait for user: ${username}`);
        await this.loginPage.loginFlow(username, password);
        await this.loginPage.waitForPostLoginReady();
        Logger.info('Post-login dashboard ready');
    }
}
