import { test } from '../../fixtures/test.fixture';

test.describe('Authentication Tests', () => {

    test('should login successfully with valid credentials', async ({ loginAction }) => {
        // loginAndWaitForLoad asserts the dashboard heading is visible internally
        await loginAction.loginAndWaitForLoad();
    });

    test('should show error for invalid credentials', async ({ loginAction }) => {
        await loginAction.verifyInvalidLoginShowsError('invalid_user@test.com', 'wrong_password');
    });

});
