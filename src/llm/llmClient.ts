import { getLLMProvider, getLLMLoggingConfig } from '../config/env';
import { logger, redactSecrets } from '../utils/logger';
import { callGemini } from './geminiClient';
import { callOpenAI } from './openaiClient';

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
}
