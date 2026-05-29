import { normalizeGeneratedWebsiteUrlUsage } from './websiteUrl';

export { normalizeGeneratedWebsiteUrlUsage };

/**
 * Fixes LLM/deterministic misuse of selectCustomDropdown for button clicks (e.g. Edit with "").
 */
export function normalizeGeneratedSelectMisuse(code: string): string {
  let next = code;

  next = next.replace(
    /await selectCustomDropdown\(page,\s*\(\)\s*=>\s*([^,]+),\s*""\s*\)/g,
    'await $1.click()'
  );

  next = next.replace(
    /await selectCustomDropdown\(page,\s*\(\)\s*=>\s*([^,]+),\s*''\s*\)/g,
    'await $1.click()'
  );

  return next;
}
