import { test } from '../../fixtures/test.fixture';
import { GENERATED_LOGIN_TEST_DATA } from '../../test-data/generated-login/generated-login.data';

test.describe("Generated Login", () => {
  test("TC-AUTH-001 - should show error for invalid credentials", async ({ generatedLoginAction, generatedLoginPage }) => {
    await generatedLoginAction.performShouldShowErrorForInvalidCredentials(GENERATED_LOGIN_TEST_DATA);
    await generatedLoginPage.expectErrorMessageText(String(GENERATED_LOGIN_TEST_DATA.expectedError));
  });
});
