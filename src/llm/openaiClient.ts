import OpenAI from 'openai';
import { getOpenAIEnv } from '../config/env';
import { logger, redactSecrets } from '../utils/logger';

const MAX_RETRIES = 3;

export async function callLLM(prompt: string): Promise<string> {
  const env = getOpenAIEnv();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const safePrompt = redactSecrets(prompt);

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await client.chat.completions.create({
        model: env.OPENAI_MODEL,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You are a senior QA automation architect. Return only the requested artifact. Never include credentials or secrets.'
          },
          {
            role: 'user',
            content: safePrompt
          }
        ]
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('OpenAI returned an empty response.');
      }

      return content.trim();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`OpenAI call failed on attempt ${attempt}/${MAX_RETRIES}: ${message}`);

      if (attempt < MAX_RETRIES) {
        await delay(1000 * attempt);
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`OpenAI call failed after ${MAX_RETRIES} attempts: ${message}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
