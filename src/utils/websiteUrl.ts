/**
 * WEBSITE_URL is the full application entry URL (typically the login page).
 * Recon and generated tests must navigate to it as-is — never append /login again.
 */

export function normalizeWebsiteEntryUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function websiteUrlPromptRules(entryUrl: string): string {
  const normalized = normalizeWebsiteEntryUrl(entryUrl);
  return [
    'WEBSITE_URL rules (mandatory):',
    `- process.env.WEBSITE_URL is the full entry URL: ${normalized}`,
    '- For opening the app or logging in: `await page.goto(process.env.WEBSITE_URL!)` only.',
    '- NEVER append `/login`, `/login/`, or any other path segment to WEBSITE_URL.',
    '- Do not treat WEBSITE_URL as a bare domain or origin; it already includes the login route when configured that way.',
    '- Do not add comments claiming WEBSITE_URL is only a base domain.'
  ].join('\n');
}

/**
 * LLMs often emit `${WEBSITE_URL}/login/` even when .env already points at /login.
 * Rewrites those patterns so regenerated tests stay aligned with recon.
 */
function websiteUrlGotoTarget(captured: string): string {
  if (captured.includes('process.env.WEBSITE_URL')) {
    return 'process.env.WEBSITE_URL!';
  }
  return 'WEBSITE_URL';
}

export function normalizeGeneratedWebsiteUrlUsage(code: string): string {
  let next = code;

  const gotoTemplateLiteral =
    /page\.goto\(\s*`(\$\{WEBSITE_URL\}|\$\{process\.env\.WEBSITE_URL!?\})\/login\/?`\s*(?:,\s*[^)]+)?\)/g;
  next = next.replace(gotoTemplateLiteral, (_match, captured: string) => `page.goto(${websiteUrlGotoTarget(captured)})`);

  const gotoConcat =
    /page\.goto\(\s*(?:process\.env\.WEBSITE_URL!?\s*\+\s*['"`]\/login\/?['"`]|['"`]\/login\/?['"`]\s*\+\s*process\.env\.WEBSITE_URL!?)\s*(?:,\s*[^)]+)?\)/g;
  next = next.replace(gotoConcat, 'page.goto(process.env.WEBSITE_URL!)');

  const bareConcat = /(\$\{WEBSITE_URL\}|process\.env\.WEBSITE_URL!?)\s*\+\s*['"`]\/login\/?['"`]/g;
  next = next.replace(bareConcat, (_match, captured: string) => websiteUrlGotoTarget(captured));

  next = next.replace(/`\$\{WEBSITE_URL\}\/login\/?`/g, 'WEBSITE_URL');
  next = next.replace(/`\$\{process\.env\.WEBSITE_URL!?\}\/login\/?`/g, 'process.env.WEBSITE_URL!');

  return next;
}
