import dotenv from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

dotenv.config();

const booleanFromString = z
  .preprocess((value) => {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true';
    }
    return false;
  }, z.boolean())
  .default(false);

const booleanFromStringDefaultTrue = z
  .preprocess((value) => {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true';
    }
    if (value === undefined || value === '') {
      return true;
    }
    return true;
  }, z.boolean())
  .default(true);

const numberFromString = z
  .preprocess((value) => {
    if (value === undefined || value === '') {
      return 0;
    }
    return Number(value);
  }, z.number().nonnegative())
  .default(0);

const positiveNumberFromString = (defaultValue: number) =>
  z
    .preprocess((value) => {
      if (value === undefined || value === '') {
        return defaultValue;
      }
      return Number(value);
    }, z.number().int().positive())
    .default(defaultValue);

const llmProviderSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return value.toLowerCase();
  }
  return value;
}, z.enum(['openai', 'gemini']).default('openai'));

const actionDecisionModeSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return value.toLowerCase();
  }
  return value;
}, z.enum(['llm_first', 'deterministic_first']).default('deterministic_first'));

const sharedSchema = z.object({
  LLM_PROVIDER: llmProviderSchema,
  ACTION_DECISION_MODE: actionDecisionModeSchema,
  HEADLESS: booleanFromString,
  SLOW_MO: numberFromString
});

const optionalPath = z.string().trim().min(1).optional();

const frameworkPathSchema = z.object({
  INPUT_FLOW_PATH: optionalPath,
  INPUT_DATA_PATH: optionalPath,
  SCENARIO_OUTPUT_DIR: optionalPath,
  RECON_SUMMARY_OUTPUT_DIR: optionalPath,
  DYNAMIC_RECON_OUTPUT_DIR: optionalPath,
  GENERATED_TEST_OUTPUT_DIR: optionalPath,
  GENERATED_TEST_QUARANTINE_DIR: optionalPath,
  HEALED_TEST_OUTPUT_DIR: optionalPath,
  REPORT_OUTPUT_DIR: optionalPath,
  GENERATION_REPORT_PATH: optionalPath,
  RUN_RESULT_PATH: optionalPath,
  LOCATOR_VALIDATION_REPORT_PATH: optionalPath,
  FINAL_REPORT_JSON_PATH: optionalPath,
  FINAL_REPORT_HTML_PATH: optionalPath,
  DYNAMIC_REPORT_JSON_PATH: optionalPath,
  DYNAMIC_REPORT_HTML_PATH: optionalPath,
  HEALING_REPORT_PATH: optionalPath
});

const locatorPolicySchema = z.object({
  ALLOW_XPATH_LOCATORS: booleanFromString,
  ALLOW_POSITIONAL_LOCATORS: booleanFromString
});

const llmLoggingSchema = z.object({
  LOG_LLM_IO: booleanFromString,
  LLM_IO_MAX_CHARS: positiveNumberFromString(20_000)
});

const openAISchema = sharedSchema.extend({
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini')
});

const geminiSchema = sharedSchema.extend({
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash')
});

const webSchema = sharedSchema.extend({
  WEBSITE_URL: z.string().url('WEBSITE_URL must be a valid URL'),
  LOGIN_EMAIL: z.string().min(1, 'LOGIN_EMAIL is required'),
  LOGIN_PASSWORD: z.string().min(1, 'LOGIN_PASSWORD is required')
});

export type LLMProvider = z.infer<typeof llmProviderSchema>;
export type ActionDecisionMode = z.infer<typeof actionDecisionModeSchema>;
export type BaseEnv = z.infer<typeof sharedSchema>;
export type OpenAIEnv = z.infer<typeof openAISchema>;
export type GeminiEnv = z.infer<typeof geminiSchema>;
export type WebEnv = z.infer<typeof webSchema>;
export type LocatorPolicy = z.infer<typeof locatorPolicySchema>;
export type LLMLoggingConfig = z.infer<typeof llmLoggingSchema>;

export interface FrameworkPaths {
  inputFlowPath: string;
  inputDataPath: string;
  scenarioDir: string;
  reconSummaryDir: string;
  dynamicReconDir: string;
  generatedTestsDir: string;
  generatedTestsQuarantineDir: string;
  healedTestsDir: string;
  reportDir: string;
  generationReportPath: string;
  runResultPath: string;
  locatorValidationReportPath: string;
  finalReportJsonPath: string;
  finalReportHtmlPath: string;
  dynamicReportJsonPath: string;
  dynamicReportHtmlPath: string;
  healingReportPath: string;
}

export function getLLMProvider(): LLMProvider {
  return sharedSchema.parse(process.env).LLM_PROVIDER;
}

export function getActionDecisionMode(): ActionDecisionMode {
  return sharedSchema.parse(process.env).ACTION_DECISION_MODE;
}

export function getBaseEnv(): BaseEnv {
  return sharedSchema.parse(process.env);
}

export function getOpenAIEnv(): OpenAIEnv {
  return openAISchema.parse(process.env);
}

export function getGeminiEnv(): GeminiEnv {
  return geminiSchema.parse(process.env);
}

export function getWebEnv(): WebEnv {
  return webSchema.parse(process.env);
}

export function getFrameworkPaths(): FrameworkPaths {
  const env = frameworkPathSchema.parse(process.env);
  const reportDir = resolveProjectPath(env.REPORT_OUTPUT_DIR, 'reports');

  return {
    inputFlowPath: resolveProjectPath(env.INPUT_FLOW_PATH, 'scenarios_combined.csv'),
    inputDataPath: resolveProjectPath(env.INPUT_DATA_PATH, 'test_data.json'),
    scenarioDir: resolveProjectPath(env.SCENARIO_OUTPUT_DIR, 'scenarios'),
    reconSummaryDir: resolveProjectPath(env.RECON_SUMMARY_OUTPUT_DIR, 'recon-summary'),
    dynamicReconDir: resolveProjectPath(env.DYNAMIC_RECON_OUTPUT_DIR, 'dynamic-recon'),
    generatedTestsDir: resolveProjectPath(env.GENERATED_TEST_OUTPUT_DIR, 'tests', 'generated'),
    generatedTestsQuarantineDir: resolveProjectPath(env.GENERATED_TEST_QUARANTINE_DIR, 'generated-quarantine'),
    healedTestsDir: resolveProjectPath(env.HEALED_TEST_OUTPUT_DIR, 'tests', 'healed'),
    reportDir,
    generationReportPath: resolveProjectPath(env.GENERATION_REPORT_PATH, 'reports', 'generation-result.json'),
    runResultPath: resolveProjectPath(env.RUN_RESULT_PATH, 'reports', 'run-result.json'),
    locatorValidationReportPath: resolveProjectPath(env.LOCATOR_VALIDATION_REPORT_PATH, 'reports', 'locator-validation.json'),
    finalReportJsonPath: resolveProjectPath(env.FINAL_REPORT_JSON_PATH, 'reports', 'result.json'),
    finalReportHtmlPath: resolveProjectPath(env.FINAL_REPORT_HTML_PATH, 'reports', 'result.html'),
    dynamicReportJsonPath: resolveProjectPath(env.DYNAMIC_REPORT_JSON_PATH, 'reports', 'dynamic-run-result.json'),
    dynamicReportHtmlPath: resolveProjectPath(env.DYNAMIC_REPORT_HTML_PATH, 'reports', 'dynamic-run-result.html'),
    healingReportPath: resolveProjectPath(env.HEALING_REPORT_PATH, 'reports', 'healing-result.json')
  };
}

export function getLocatorPolicy(): LocatorPolicy {
  return locatorPolicySchema.parse(process.env);
}

export function getLLMLoggingConfig(): LLMLoggingConfig {
  return llmLoggingSchema.parse(process.env);
}

export function requireEnvValue(
  name: 'WEBSITE_URL' | 'LOGIN_EMAIL' | 'LOGIN_PASSWORD' | 'OPENAI_API_KEY' | 'GEMINI_API_KEY'
): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required. Copy .env.example to .env and set ${name}.`);
  }
  return value;
}

function resolveProjectPath(value: string | undefined, ...fallbackSegments: string[]): string {
  const baseDir = process.env.ORCHESTAI_OUTPUT_DIR || process.cwd();
  const target = value ?? path.join(...fallbackSegments);
  return path.isAbsolute(target) ? target : path.resolve(baseDir, target);
}
