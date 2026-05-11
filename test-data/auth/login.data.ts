import { ConfigManager } from "../../core/config/ConfigManager";

/**
 * Central test data store.
 * Replace placeholder values with real test credentials / fixtures.
 */
export const TEST_DATA = {
  // Global
  baseUrl: ConfigManager.BASE_URL,

  // Login data
  loginUsername: ConfigManager.USERNAME,
  loginPassword: ConfigManager.PASSWORD
};

export type TestData = typeof TEST_DATA;
