import type { Page } from '@playwright/test';
import { logger } from '../utils/logger';

/**
 * Attempts to dismiss any blocking modals on the page.
 * Modals are common causes of locator failures (e.g. click intercepts).
 */
export async function dismissBlockingModals(page: Page): Promise<boolean> {
  logger.info('Checking for blocking modals to dismiss...');
  try {
    const modalLocators = [
      page.locator('[role="dialog"]'),
      page.locator('.modal'),
      page.locator('.dialog'),
      page.locator('dialog')
    ];

    for (const modal of modalLocators) {
      if (await modal.isVisible()) {
        logger.info('Found active modal. Searching for close/cancel buttons...');
        const closeButton = modal.locator('button').filter({ hasText: /close|cancel|dismiss|✖/i }).first();
        if (await closeButton.isVisible() && await closeButton.isEnabled()) {
          logger.info('Clicking modal close button.');
          await closeButton.click();
          return true;
        }

        // Try clicking outside or Escape
        logger.info('Attempting Escape key to dismiss modal.');
        await page.keyboard.press('Escape');
        return true;
      }
    }
  } catch (err) {
    logger.warn('Failed to dismiss blocking modals:', err);
  }
  return false;
}

/**
 * Attempts recovery on locator failure.
 * Returns true if recovery succeeded and execution should be retried.
 */
export async function attemptRecovery(page: Page, errorMsg: string, lastGoodUrl?: string): Promise<boolean> {
  logger.info(`Attempting recovery for action error: ${errorMsg}`);

  // 1. Try to dismiss blocking modals
  const dismissed = await dismissBlockingModals(page);
  if (dismissed) {
    logger.info('Dismissed modal. Retrying action...');
    return true;
  }

  // 2. If modal dismissal didn't work and we have a lastGoodUrl, try re-navigating
  if (lastGoodUrl && page.url() !== lastGoodUrl) {
    logger.info(`Re-navigating to last known good URL: ${lastGoodUrl}`);
    try {
      await page.goto(lastGoodUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 });
      return true;
    } catch (err) {
      logger.warn('Failed to re-navigate during recovery:', err);
    }
  }

  return false;
}

/**
 * Relaxes validation thresholds or handles postcondition failure recovery.
 */
export function shouldRelaxPostcondition(errorMsg: string): boolean {
  // Relax validation if the error suggests a layout change false negative
  return /postcondition_failure/i.test(errorMsg);
}
