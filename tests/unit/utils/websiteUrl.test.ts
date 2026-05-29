import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  normalizeGeneratedWebsiteUrlUsage,
  normalizeWebsiteEntryUrl,
  websiteUrlPromptRules
} from '../../../src/utils/websiteUrl';

describe('websiteUrl', () => {
  it('strips trailing slashes from entry URL', () => {
    assert.equal(normalizeWebsiteEntryUrl('https://app.example.com/login/'), 'https://app.example.com/login');
  });

  it('includes never-append-login rule in prompt', () => {
    assert.match(websiteUrlPromptRules('https://app.example.com/login'), /NEVER append/);
  });

  it('normalizes duplicated login path in goto', () => {
    assert.equal(
      normalizeGeneratedWebsiteUrlUsage('await page.goto(`${WEBSITE_URL}/login/`);'),
      'await page.goto(WEBSITE_URL);'
    );
    assert.equal(
      normalizeGeneratedWebsiteUrlUsage('await page.goto(`${process.env.WEBSITE_URL!}/login/`);'),
      'await page.goto(process.env.WEBSITE_URL!);'
    );
    assert.equal(
      normalizeGeneratedWebsiteUrlUsage("await page.goto(process.env.WEBSITE_URL! + '/login/');"),
      'await page.goto(process.env.WEBSITE_URL!);'
    );
  });
});
