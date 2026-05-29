import dotenv from 'dotenv';
import { z } from 'zod';
import { normalizeWebsiteEntryUrl } from '../utils/websiteUrl';

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

const numberFromString = z
  .preprocess((value) => {
    if (value === undefined || value === '') {
      return 0;
    }
    return Number(value);
  }, z.number().nonnegative())
  .default(0);

const llmProviderSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return value.toLowerCase();
  }
  return value;
}, z.enum(['openai', 'gemini']).default('openai'));

const sharedSchema = z.object({
  LLM_PROVIDER: llmProviderSchema,
  HEADLESS: booleanFromString,
  SLOW_MO: numberFromString
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
  WEBSITE_URL: z
    .string()
    .url('WEBSITE_URL must be a valid URL')
    .transform((value) => normalizeWebsiteEntryUrl(value)),
  LOGIN_EMAIL: z.string().min(1, 'LOGIN_EMAIL is required'),
  LOGIN_PASSWORD: z.string().min(1, 'LOGIN_PASSWORD is required')
});

export type LLMProvider = z.infer<typeof llmProviderSchema>;
export type BaseEnv = z.infer<typeof sharedSchema>;
export type OpenAIEnv = z.infer<typeof openAISchema>;
export type GeminiEnv = z.infer<typeof geminiSchema>;
export type WebEnv = z.infer<typeof webSchema>;

export function getLLMProvider(): LLMProvider {
  return sharedSchema.parse(process.env).LLM_PROVIDER;
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

export function requireEnvValue(
  name: 'WEBSITE_URL' | 'LOGIN_EMAIL' | 'LOGIN_PASSWORD' | 'OPENAI_API_KEY' | 'GEMINI_API_KEY'
): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required. Copy .env.example to .env and set ${name}.`);
  }
  return value;
}
