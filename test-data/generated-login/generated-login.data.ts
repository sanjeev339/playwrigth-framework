export const GENERATED_LOGIN_TEST_DATA = {
    "loginUrl": "https://backoffice.qa.zice.it/login",
    "username": "invalid_user@testmail.dev",
    "password": "wrong-password",
    "expectedError": "Invalid"
  } as const;

export type GeneratedLoginTestData = typeof GENERATED_LOGIN_TEST_DATA;
