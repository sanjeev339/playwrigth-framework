import { getLLMProvider, getLLMLoggingConfig } from '../config/env';
import { logger, redactSecrets } from '../utils/logger';
import { callGemini } from './geminiClient';
import { callOpenAI } from './openaiClient';

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRateLimitError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? '').toLowerCase();
  return msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests');
}

function isTransientError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? '').toLowerCase();
  return msg.includes('timeout') || msg.includes('econnreset') || msg.includes('503');
}

export async function callLLM(prompt: string, context?: string): Promise<string> {
  const provider = getLLMProvider();
  const logConfig = getLLMLoggingConfig();
  const contextPrefix = context ? `[LLM][${context.toUpperCase()}] ` : '[LLM] ';

  if (logConfig.LOG_LLM_IO) {
    const maxChars = logConfig.LLM_IO_MAX_CHARS;
    const safePrompt = redactSecrets(prompt);
    const truncatedPrompt =
      safePrompt.length > maxChars
        ? safePrompt.slice(0, maxChars) + `\n... [TRUNCATED - total length ${safePrompt.length} chars]`
        : safePrompt;
    logger.info(`${contextPrefix}Sending prompt to ${provider}:\n${truncatedPrompt}`);
  } else {
    logger.info(`${contextPrefix}Calling ${provider}`);
  }

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = provider === 'gemini' ? await callGemini(prompt) : await callOpenAI(prompt);

      if (logConfig.LOG_LLM_IO) {
        const maxChars = logConfig.LLM_IO_MAX_CHARS;
        const safeResponse = redactSecrets(response);
        const truncatedResponse =
          safeResponse.length > maxChars
            ? safeResponse.slice(0, maxChars) + `\n... [TRUNCATED - total length ${safeResponse.length} chars]`
            : safeResponse;
        logger.info(`${contextPrefix}Received response from ${provider}:\n${truncatedResponse}`);
      }

      return response;
    } catch (err: unknown) {
      lastError = err as Error;
      const isRetryable = isRateLimitError(err) || isTransientError(err);
      if (!isRetryable || attempt === MAX_RETRIES) {
        logger.error(`${contextPrefix}Attempt ${attempt} failed with non-retryable error: ${(err as Error).message}`);
        throw err;
      }

      const delayMs = INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
      logger.warn(`${contextPrefix}Attempt ${attempt} failed (${(err as Error).message}). Retrying in ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }

  throw lastError;
}
