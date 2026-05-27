import dotenv from 'dotenv';
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

const numberFromString = z
  .preprocess((value) => {
    if (value === undefined || value === '') {
      return 0;
    }
    return Number(value);
  }, z.number().nonnegative())
  .default(0);

const baseSchema = z.object({
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  HEADLESS: booleanFromString,
  SLOW_MO: numberFromString
});

const openAISchema = baseSchema.extend({
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required')
});

const webSchema = baseSchema.extend({
  WEBSITE_URL: z.string().url('WEBSITE_URL must be a valid URL'),
  LOGIN_EMAIL: z.string().min(1, 'LOGIN_EMAIL is required'),
  LOGIN_PASSWORD: z.string().min(1, 'LOGIN_PASSWORD is required')
});

export type BaseEnv = z.infer<typeof baseSchema>;
export type OpenAIEnv = z.infer<typeof openAISchema>;
export type WebEnv = z.infer<typeof webSchema>;

export function getBaseEnv(): BaseEnv {
  return baseSchema.parse(process.env);
}

export function getOpenAIEnv(): OpenAIEnv {
  return openAISchema.parse(process.env);
}

export function getWebEnv(): WebEnv {
  return webSchema.parse(process.env);
}

export function requireEnvValue(name: 'WEBSITE_URL' | 'LOGIN_EMAIL' | 'LOGIN_PASSWORD' | 'OPENAI_API_KEY'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required. Copy .env.example to .env and set ${name}.`);
  }
  return value;
}
