import { getLLMProvider } from '../config/env';
import { logger } from '../utils/logger';
import { callGemini } from './geminiClient';
import { callOpenAI } from './openaiClient';

export async function callLLM(prompt: string): Promise<string> {
  const provider = getLLMProvider();
  logger.info(`LLM provider: ${provider}`);

  if (provider === 'gemini') {
    return callGemini(prompt);
  }

  return callOpenAI(prompt);
}
