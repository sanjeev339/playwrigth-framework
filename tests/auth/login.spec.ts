import { test, expect } from '../../fixtures/test.fixture';
import { ConfigManager } from '../../core/config/ConfigManager';

test.describe('Authentication Tests', () => {
    test('should login successfully with valid credentials', async ({ loginAction, loginPage }) => {
        await loginAction.login(ConfigManager.USERNAME, ConfigManager.PASSWORD);
        await expect(loginPage.dashboardHeading).toBeVisible();
    });

    test('should show error for invalid credentials', async ({ loginPage }) => {
        await loginPage.loginFlow('invalid_user', 'invalid_pass');
        const errorMsg = await loginPage.getErrorMessage();
        expect(errorMsg).toBeTruthy();
    });
});
