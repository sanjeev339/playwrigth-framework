import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import type { Page, Locator } from '@playwright/test';
import { shouldRelaxPostcondition, attemptRecovery, dismissBlockingModals } from '../../../src/recon/reconRecovery';

describe('reconRecovery', () => {
  it('correctly detects when postconditions should be relaxed', () => {
    assert.ok(shouldRelaxPostcondition('postcondition_failure: DOM diff too small'));
    assert.ok(!shouldRelaxPostcondition('locator timeout'));
  });

  it('attempts to dismiss blocking modals and returns true if dismissed', async () => {
    let clickedClose = false;
    let escapePressed = false;

    const mockModal = {
      isVisible: async () => true,
      isEnabled: async () => true,
      locator: (selector: string) => ({
        filter: () => ({
          first: () => ({
            isVisible: async () => true,
            isEnabled: async () => true,
            click: async () => {
              clickedClose = true;
            }
          })
        })
      })
    } as unknown as Locator;

    const mockPage = {
      locator: (selector: string) => {
        if (selector === '[role="dialog"]') return mockModal;
        return { isVisible: async () => false } as unknown as Locator;
      },
      keyboard: {
        press: async (key: string) => {
          if (key === 'Escape') escapePressed = true;
        }
      }
    } as unknown as Page;

    const result = await dismissBlockingModals(mockPage);
    assert.ok(result);
    assert.ok(clickedClose);
  });

  it('attempts re-navigation if modal dismissal is not possible and target URL is different', async () => {
    let navigatedUrl = '';
    const mockPage = {
      locator: () => ({ isVisible: async () => false } as unknown as Locator),
      url: () => 'https://example.com/wrong-page',
      goto: async (url: string) => {
        navigatedUrl = url;
      }
    } as unknown as Page;

    const result = await attemptRecovery(mockPage, 'element not interactable', 'https://example.com/dashboard');
    assert.ok(result);
    assert.equal(navigatedUrl, 'https://example.com/dashboard');
  });
});
