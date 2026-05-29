import { GoogleGenAI } from '@google/genai';
import { getGeminiEnv } from '../config/env';
import { formatForLog, logger, redactSecrets } from '../utils/logger';

/** Inclusive upper bound for attempt index (attempts = MAX_RETRY_ATTEMPT_INDEX + 1). */
const MAX_RETRY_ATTEMPT_INDEX = 3;
const SYSTEM_PROMPT =
  'You are a senior QA automation architect. Return only the requested artifact. Never include credentials or secrets.';

export async function callGemini(prompt: string): Promise<string> {
  const env = getGeminiEnv();
  logger.info(`Calling Gemini model "${env.GEMINI_MODEL}" (prompt length: ${prompt.length} chars).`);
  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const safePrompt = redactSecrets(prompt);

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPT_INDEX; attempt += 1) {
    try {
      const response = await client.models.generateContent({
        model: env.GEMINI_MODEL,
        contents: safePrompt,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.2
        }
      });

      const content = response.text?.trim();
      if (!content) {
        throw new Error('Gemini returned an empty response.');
      }

      return content;
    } catch (error) {
      lastError = error;
      logger.warn(
        `Gemini call failed on attempt ${attempt + 1}/${MAX_RETRY_ATTEMPT_INDEX + 1}`,
        error
      );

      if (!isRetryableLlmError(error) || attempt >= MAX_RETRY_ATTEMPT_INDEX) {
        break;
      }

      const retryDelayMs = parseRetryDelayMs(error) ?? 1000 * 2 ** attempt;
      await delay(retryDelayMs);
    }
  }

  throw new Error(`Gemini call failed: ${formatForLog(lastError)}`);
}

function isRetryableLlmError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status === 408 || status === 429 || status === 502 || status === 503 || status === 504) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return (
    /rate limit|429|resource_exhausted|too many requests|quota/i.test(message) ||
    /(^|\b)(503|502|504|408)(\b|$)/i.test(message) ||
    /unavailable|high demand|overload|try again later|temporarily|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(
      message
    )
  );
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const candidate = error as { status?: unknown; code?: unknown };
  if (typeof candidate.status === 'number') {
    return candidate.status;
  }

  if (typeof candidate.code === 'number') {
    return candidate.code;
  }

  return undefined;
}

function parseRetryDelayMs(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const retrySecondsMatch = message.match(/retry in (\d+(?:\.\d+)?)s/i);
  if (retrySecondsMatch?.[1]) {
    return Math.ceil(Number(retrySecondsMatch[1]) * 1000);
  }

  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const errorObject = error as { error?: { details?: unknown[] } };
  const details = errorObject.error?.details;
  if (!Array.isArray(details)) {
    return null;
  }

  for (const detail of details) {
    if (typeof detail !== 'object' || detail === null) {
      continue;
    }

    const retryDelay = (detail as { retryDelay?: unknown }).retryDelay;
    if (typeof retryDelay === 'string') {
      const seconds = Number(retryDelay.replace(/s$/i, ''));
      if (!Number.isNaN(seconds) && seconds > 0) {
        return Math.ceil(seconds * 1000);
      }
    }
  }

  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
