import OpenAI from 'openai';
import { getOpenAIEnv } from '../config/env';
import { formatForLog, logger, redactSecrets } from '../utils/logger';

/** Inclusive upper bound for attempt index (attempts = MAX_RETRY_ATTEMPT_INDEX + 1). */
const MAX_RETRY_ATTEMPT_INDEX = 3;
const SYSTEM_PROMPT =
  'You are a senior QA automation architect. Return only the requested artifact. Never include credentials or secrets.';

export async function callOpenAI(prompt: string): Promise<string> {
  const env = getOpenAIEnv();
  logger.info(`Calling OpenAI model "${env.OPENAI_MODEL}" (prompt length: ${prompt.length} chars).`);
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const safePrompt = redactSecrets(prompt);

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPT_INDEX; attempt += 1) {
    try {
      const response = await client.chat.completions.create({
        model: env.OPENAI_MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: safePrompt }
        ]
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new Error('OpenAI returned an empty response.');
      }

      return content;
    } catch (error) {
      lastError = error;
      logger.warn(
        `OpenAI call failed on attempt ${attempt + 1}/${MAX_RETRY_ATTEMPT_INDEX + 1}`,
        error
      );

      if (!isRetryableLlmError(error) || attempt >= MAX_RETRY_ATTEMPT_INDEX) {
        break;
      }

      await delay(1000 * 2 ** attempt);
    }
  }

  throw new Error(`OpenAI call failed: ${formatForLog(lastError)}`);
}

function isRetryableLlmError(error: unknown): boolean {
  if (error instanceof OpenAI.APIError) {
    const status = error.status;
    if (status === 408 || status === 429 || status === 502 || status === 503 || status === 504) {
      return true;
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  return (
    /rate limit|429|too many requests|quota/i.test(message) ||
    /(^|\b)(503|502|504|408)(\b|$)/i.test(message) ||
    /unavailable|high demand|overload|try again later|temporarily|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(
      message
    )
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
