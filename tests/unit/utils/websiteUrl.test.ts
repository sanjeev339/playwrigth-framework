import assert from 'node:assert/strict';
import {
  normalizeGeneratedWebsiteUrlUsage,
  normalizeWebsiteEntryUrl,
  websiteUrlPromptRules
} from '../../../src/utils/websiteUrl';

assert.equal(normalizeWebsiteEntryUrl('https://app.example.com/login/'), 'https://app.example.com/login');

assert.match(
  websiteUrlPromptRules('https://app.example.com/login'),
  /NEVER append/
);

const duplicatedGoto = "await page.goto(`${WEBSITE_URL}/login/`);";
assert.equal(
  normalizeGeneratedWebsiteUrlUsage(duplicatedGoto),
  'await page.goto(WEBSITE_URL);'
);

const envGoto = "await page.goto(`${process.env.WEBSITE_URL!}/login/`);";
assert.equal(
  normalizeGeneratedWebsiteUrlUsage(envGoto),
  'await page.goto(process.env.WEBSITE_URL!);'
);

const concatGoto = "await page.goto(process.env.WEBSITE_URL! + '/login/');";
assert.equal(
  normalizeGeneratedWebsiteUrlUsage(concatGoto),
  'await page.goto(process.env.WEBSITE_URL!);'
);

console.log('websiteUrl.test.ts: all assertions passed');
