/**
 * page-recon.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Reconnaissance Utility — Phase B of the Discovery Workflow
 *
 * PURPOSE:
 *   Automatically extracts ALL locator attributes from every interactive
 *   element on a page. Replaces manual DevTools inspection entirely.
 *   Produces a structured JSON report + Markdown locator map that Claude
 *   (or a developer) can use directly to write Page Objects.
 *
 * WHAT IT CAPTURES (per element):
 *   id, name, type, placeholder, aria-label, data-testid,
 *   data-pc-name, label text, button text, XPath, screen position
 *
 * HOW TO RUN:
 *   npx ts-node utils/page-recon.ts <url> [outputDir]
 *
 * EXAMPLES:
 *   npx ts-node utils/page-recon.ts https://backoffice.qa.zice.it/login
 *   npx ts-node utils/page-recon.ts https://backoffice.qa.zice.it/configuration/framework ./recon-output
 *
 * OUTPUT (written to outputDir, defaults to ./recon-output/):
 *   ├── screenshot-<pageName>.png      ← visual of the page
 *   ├── locators-<pageName>.json       ← raw element data (all attributes)
 *   └── locators-<pageName>.md         ← ready-to-paste locator map for Claude
 *
 * USAGE WITH CLAUDE:
 *   1. Run this script against any page
 *   2. Paste the .md output into Claude
 *   3. Claude uses it to write the Page Object — zero guessing, zero DevTools
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { chromium, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../core/config/ConfigManager';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ElementInfo {
  tag: string;
  id: string | null;
  name: string | null;
  type: string | null;
  placeholder: string | null;
  labelFor: string | null;
  ariaLabel: string | null;
  dataTestId: string | null;
  dataPcName: string | null;
  text: string | null;
  xpath: string;
  visible: boolean;
  position: { x: number; y: number };
  suggestedLocators: string[];
}

interface ReconReport {
  url: string;
  pageTitle: string;
  capturedAt: string;
  elements: ElementInfo[];
}

// ── Core extraction logic (runs inside the browser) ───────────────────────────

async function extractAllElements(page: Page): Promise<ElementInfo[]> {
  const elements = await page
    .locator('input, textarea, select, button, a[href], label, [role="tab"], [role="button"]')
    .all();

  const report: ElementInfo[] = [];

  for (const el of elements) {
    const info = await el.evaluate((e: Element) => {
      // ── XPath builder ──────────────────────────────────────────────────────
      const getXPath = (element: Element): string => {
        if ((element as HTMLElement).id) {
          return `//*[@id="${(element as HTMLElement).id}"]`;
        }
        if (element === document.body) return '/html/body';
        const parent = element.parentNode as Element;
        if (!parent) return element.tagName.toLowerCase();
        const siblings = Array.from(parent.childNodes).filter(
          (n) => (n as Element).nodeType === 1 && (n as Element).tagName === element.tagName,
        );
        const idx = siblings.indexOf(element) + 1;
        return getXPath(parent) + `/${element.tagName.toLowerCase()}[${idx}]`;
      };

      const el = e as HTMLInputElement;
      const rect = el.getBoundingClientRect();

      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        name: el.getAttribute('name') || null,
        type: el.getAttribute('type') || null,
        placeholder: el.getAttribute('placeholder') || null,
        labelFor: el.getAttribute('for') || null,
        ariaLabel: el.getAttribute('aria-label') || null,
        dataTestId: el.getAttribute('data-testid') || null,
        dataPcName: el.getAttribute('data-pc-name') || null,
        text: el.innerText?.trim().substring(0, 60) || null,
        xpath: getXPath(el),
        visible: rect.width > 0 && rect.height > 0,
        position: { x: Math.round(rect.x), y: Math.round(rect.y) },
      };
    });

    // ── Generate suggested Playwright locators in priority order ──────────────
    const suggestions: string[] = [];

    // 1. getByRole (most resilient)
    if (info.tag === 'button' && info.text) {
      suggestions.push(`page.getByRole('button', { name: '${info.text}' })`);
    }
    if (info.tag === 'a' && info.text) {
      suggestions.push(`page.getByRole('link', { name: '${info.text}' })`);
    }

    // 2. getByTestId
    if (info.dataTestId) {
      suggestions.push(`page.getByTestId('${info.dataTestId}')`);
    }

    // 3. getByLabel (for inputs with a linked label)
    if (info.labelFor && info.tag === 'label') {
      suggestions.push(`page.getByLabel('${info.text}')`);
    }

    // 4. getByPlaceholder
    if (info.placeholder) {
      suggestions.push(`page.getByPlaceholder('${info.placeholder}')`);
    }

    // 5. ID-based CSS
    if (info.id) {
      suggestions.push(`page.locator('#${info.id.replace(/ /g, '\\ ')}')`);
      suggestions.push(`page.locator('[id="${info.id}"]')`);
    }

    // 6. name attribute
    if (info.name) {
      suggestions.push(`page.locator('${info.tag}[name="${info.name}"]')`);
    }

    // 7. XPath
    suggestions.push(`page.locator('xpath=${info.xpath}')`);

    report.push({ ...info, suggestedLocators: suggestions });
  }

  return report.filter((el) => el.visible);
}

// ── Markdown report generator ─────────────────────────────────────────────────

function generateMarkdown(report: ReconReport): string {
  const lines: string[] = [
    `# Page Reconnaissance Report`,
    ``,
    `| Field       | Value |`,
    `|-------------|-------|`,
    `| **URL**     | \`${report.url}\` |`,
    `| **Title**   | ${report.pageTitle} |`,
    `| **Captured**| ${report.capturedAt} |`,
    `| **Elements**| ${report.elements.length} interactive elements found |`,
    ``,
    `---`,
    ``,
    `## Element Locator Map`,
    `*(Paste this to Claude to generate a Page Object)*`,
    ``,
  ];

  for (const el of report.elements) {
    // Skip invisible or empty elements
    if (!el.visible) continue;

    const label =
      el.placeholder ||
      el.text ||
      el.ariaLabel ||
      el.id ||
      el.name ||
      `${el.tag}`;

    lines.push(`### \`${el.tag}\` — ${label}`);
    lines.push(``);
    lines.push(`| Attribute | Value |`);
    lines.push(`|-----------|-------|`);

    if (el.id) lines.push(`| id          | \`${el.id}\` |`);
    if (el.name) lines.push(`| name        | \`${el.name}\` |`);
    if (el.type) lines.push(`| type        | \`${el.type}\` |`);
    if (el.placeholder) lines.push(`| placeholder | \`${el.placeholder}\` |`);
    if (el.ariaLabel) lines.push(`| aria-label  | \`${el.ariaLabel}\` |`);
    if (el.dataTestId) lines.push(`| data-testid | \`${el.dataTestId}\` |`);
    if (el.dataPcName) lines.push(`| data-pc-name| \`${el.dataPcName}\` |`);
    if (el.labelFor) lines.push(`| label for   | \`${el.labelFor}\` |`);
    if (el.text) lines.push(`| text        | \`${el.text}\` |`);
    lines.push(`| xpath       | \`${el.xpath}\` |`);
    lines.push(`| position    | x:${el.position.x} y:${el.position.y} |`);
    lines.push(``);

    if (el.suggestedLocators.length > 0) {
      lines.push(`**Suggested Playwright locators (priority order):**`);
      lines.push(``);
      el.suggestedLocators.forEach((loc, i) => {
        lines.push(`${i + 1}. \`${loc}\``);
      });
    }

    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }

  return lines.join('\n');
}

// ── Main runner ───────────────────────────────────────────────────────────────

async function runRecon(targetUrl: string, outputDir = './recon-output') {
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Derive a safe filename from the URL
  const pageName = targetUrl
    .replace(/https?:\/\//, '')
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 60);

  console.log(`\n🔍 Starting reconnaissance on: ${targetUrl}`);

  const browser = await chromium.launch({ headless: false }); // headed so you can see it
  const page = await browser.newPage();

  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000); // brief settle

  // ── 0. Handle Authentication if redirected to login ────────────────────────
  if (page.url().includes('/login') || (await page.locator('input[name="email"]').isVisible())) {
    console.log('🔒 Authentication required. Performing login...');
    if (!ConfigManager.USERNAME || !ConfigManager.PASSWORD) {
      console.warn('⚠ ConfigManager.USERNAME or PASSWORD missing. Cannot login.');
    } else {
      await page.locator('input[name="email"]').fill(ConfigManager.USERNAME);
      await page.locator('input[name="password"]').fill(ConfigManager.PASSWORD);
      await page.locator('button').filter({ hasText: /^Login$/ }).click();

      try {
        await page.waitForURL(url => !url.href.includes('/login'), { timeout: 15000 });
        console.log('✅ Login successful. Returning to target URL...');
        await page.goto(targetUrl, { waitUntil: 'networkidle' });
      } catch (e) {
        console.error('❌ Login failed or timed out.');
      }
    }
  }

  const pageTitle = await page.title();
  console.log(`📄 Page title: ${pageTitle}`);

  // ── 1. Screenshot ──────────────────────────────────────────────────────────
  const screenshotPath = path.join(outputDir, `screenshot-${pageName}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`📸 Screenshot saved: ${screenshotPath}`);

  // ── 2. Extract all element attributes ──────────────────────────────────────
  console.log(`🔎 Extracting element attributes...`);
  const elements = await extractAllElements(page);
  console.log(`✅ Found ${elements.length} visible interactive elements`);

  const report: ReconReport = {
    url: targetUrl,
    pageTitle,
    capturedAt: new Date().toISOString(),
    elements,
  };

  // ── 3. Write JSON ──────────────────────────────────────────────────────────
  const jsonPath = path.join(outputDir, `locators-${pageName}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`📋 JSON report saved: ${jsonPath}`);

  // ── 4. Write Markdown ──────────────────────────────────────────────────────
  const markdown = generateMarkdown(report);
  const mdPath = path.join(outputDir, `locators-${pageName}.md`);
  fs.writeFileSync(mdPath, markdown);
  console.log(`📝 Markdown report saved: ${mdPath}`);

  console.log(`\n✨ Done! Paste ${mdPath} into Claude to generate your Page Object.\n`);

  await browser.close();
  return report;
}

// ── CLI entry point ───────────────────────────────────────────────────────────

const [, , url, outDir] = process.argv;

if (!url) {
  console.error('\nUsage: npx ts-node utils/page-recon.ts <url> [outputDir]\n');
  console.error('Example: npx ts-node utils/page-recon.ts https://backoffice.qa.zice.it/login\n');
  process.exit(1);
}

runRecon(url, outDir).catch((err) => {
  console.error('Recon failed:', err);
  process.exit(1);
});

export { runRecon, extractAllElements, generateMarkdown };
