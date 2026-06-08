import { getLLMProvider, getLLMLoggingConfig } from '../config/env';
import { logger, redactSecrets } from '../utils/logger';
import { truncate } from '../utils/fileUtils';
import { callGemini } from './geminiClient';
import { callOpenAI } from './openaiClient';

export async function callLLM(prompt: string, context?: { caller?: string }): Promise<string> {
  const provider = getLLMProvider();
  const config = getLLMLoggingConfig();
  const caller = context?.caller ?? 'unknown';

  logger.info(`LLM provider: ${provider} (caller: ${caller})`);

  if (config.LOG_LLM_IO) {
    const safePrompt = truncate(redactSecrets(prompt), config.LLM_IO_MAX_CHARS);
    logger.info(
      `[LLM][REQUEST] caller=${caller}\n----- REQUEST START -----\n${safePrompt}\n----- REQUEST END -----`
    );
  }

  const response = provider === 'gemini' ? await callGemini(prompt) : await callOpenAI(prompt);

  if (config.LOG_LLM_IO) {
    const safeResponse = truncate(redactSecrets(response), config.LLM_IO_MAX_CHARS);
    logger.info(
      `[LLM][RESPONSE] caller=${caller}\n----- RESPONSE START -----\n${safeResponse}\n----- RESPONSE END -----`
    );
  }

  return response;
}

