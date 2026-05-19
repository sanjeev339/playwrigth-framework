import { chromium, Locator, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { LoginAction } from "../../../actions/auth/LoginAction";
import { quote } from "./names";

export type DomReconOptions = {
  enabled?: boolean;
  headed?: boolean;
  outputDir?: string;
};

export type DomReconResult = {
  ok: boolean;
  reason?: string;
  markdown?: string;
  jsonPath?: string;
  markdownPath?: string;
  screenshotPath?: string;
};

type ReconElement = {
  tag: string;
  role: string;
  text: string;
  label: string;
  placeholder: string;
  name: string;
  type: string;
  id: string;
  className: string;
  ariaLabel: string;
  dataTestId: string;
  xpath: string;
  suggestedLocators: string[];
};

type RawReconElement = Omit<ReconElement, "suggestedLocators">;

type ReconPayload = {
  scenarioId: string;
  capturedAt: string;
  url: string;
  title: string;
  formElements: ReconElement[];
  roleOptions: string[];
  screenshotPath?: string;
};

const repoRoot = process.cwd();

export function shouldRunUserManagementDomRecon(input: {
  artifact?: { scenarioId: string };
  title?: string;
  description?: string;
  steps?: unknown;
}): boolean {
  const text = [
    input.artifact?.scenarioId,
    input.title,
    input.description,
    JSON.stringify(input.steps || ""),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    /\buser management\b/.test(text) &&
    /\b(add user|internal user|first name|last name|email address)\b/.test(text)
  );
}

export async function runUserManagementAddUserDomRecon(options: {
  scenarioId: string;
  headed?: boolean;
  outputDir?: string;
}): Promise<DomReconResult> {
  const outputDir =
    options.outputDir || path.join(repoRoot, "generated_output", "dom-recon");
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: options.headed === false });
  const page = await browser.newPage();

  try {
    const loginAction = new LoginAction(page);
    await loginAction.loginAndWaitForLoad();
    await clickFirstVisible(page, "User Management navigation", [
      page.getByRole("button", { name: /user management/i }),
      page.getByRole("link", { name: /user management/i }),
      page.getByRole("menuitem", { name: /user management/i }),
      page.getByText("User Management", { exact: true }),
      page.locator('[class*="sidebar"]').getByText("User Management", {
        exact: true,
      }),
      page.locator(
        'xpath=//*[contains(@class,"sidebar")]//*[normalize-space()="User Management"]',
      ),
    ]);

    await clickFirstVisible(page, "Add User button", [
      page.getByRole("button", { name: /add user/i }),
      page.getByText("Add User", { exact: true }),
      page.locator('xpath=//button[contains(normalize-space(),"Add User")]'),
    ]);

    await clickFirstVisible(page, "Add Internal User option", [
      page.locator('[role="dialog"]').getByText("Add Internal User", {
        exact: true,
      }),
      page.getByText("Add Internal User", { exact: true }),
      page.locator(
        'xpath=//*[@role="dialog"]//*[normalize-space()="Add Internal User"]',
      ),
    ]);

    await firstVisibleLocator("Add User form first name input", [
      page.getByPlaceholder("Enter first name"),
      page.getByLabel(/^First Name/i),
      page.locator('xpath=//input[@placeholder="Enter first name"]'),
    ]);

    const formRoot = page.getByRole("dialog").last();
    await formRoot.waitFor({ state: "visible", timeout: 10_000 });
    const screenshotPath = path.join(
      outputDir,
      `${options.scenarioId.toLowerCase()}-add-user-form.png`,
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const formElements = await extractInteractiveElements(formRoot);
    const roleOptions = await captureRoleOptions(page, formRoot);
    const payload: ReconPayload = {
      scenarioId: options.scenarioId,
      capturedAt: new Date().toISOString(),
      url: page.url(),
      title: await page.title(),
      formElements,
      roleOptions,
      screenshotPath,
    };

    const jsonPath = path.join(
      outputDir,
      `${options.scenarioId.toLowerCase()}-add-user-form.json`,
    );
    const markdownPath = path.join(
      outputDir,
      `${options.scenarioId.toLowerCase()}-add-user-form.md`,
    );
    const markdown = renderDomReconMarkdown(payload);
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
    fs.writeFileSync(markdownPath, markdown);

    return {
      ok: true,
      markdown,
      jsonPath,
      markdownPath,
      screenshotPath,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await browser.close();
  }
}

async function clickFirstVisible(
  page: Page,
  purpose: string,
  candidates: Locator[],
): Promise<void> {
  const locator = await firstVisibleLocator(purpose, candidates);
  await locator.click();
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
}

async function firstVisibleLocator(
  purpose: string,
  candidates: Locator[],
): Promise<Locator> {
  for (const candidate of candidates) {
    const firstMatch = candidate.first();
    try {
      await firstMatch.waitFor({ state: "visible", timeout: 2_000 });
      return firstMatch;
    } catch {
      // Try the next tier.
    }
  }

  throw new Error(
    `DOM recon could not find a visible locator for ${purpose}. Tried ${candidates.length} candidates.`,
  );
}

async function extractInteractiveElements(root: Locator): Promise<ReconElement[]> {
  const handles = await root
    .locator(
      [
        "input",
        "textarea",
        "select",
        "button",
        "label",
        "[role]",
        "[placeholder]",
        "[data-testid]",
      ].join(", "),
    )
    .elementHandles();

  const elements: RawReconElement[] = [];

  for (const [index, handle] of handles.entries()) {
    const element = (await handle
      .evaluate(
        `element => {
          const htmlElement = element;
          const rect = htmlElement.getBoundingClientRect();
          const text = (htmlElement.innerText || htmlElement.textContent || "")
            .trim()
            .replace(/\\s+/g, " ")
            .slice(0, 120);
          const placeholder = htmlElement.getAttribute("placeholder") || "";
          const ariaLabel = htmlElement.getAttribute("aria-label") || "";
          return {
            visible: rect.width > 0 && rect.height > 0,
            tag: htmlElement.tagName.toLowerCase(),
            role: htmlElement.getAttribute("role") || "",
            text,
            label: ariaLabel || placeholder || text,
            placeholder,
            name: htmlElement.getAttribute("name") || "",
            type: htmlElement.getAttribute("type") || "",
            id: htmlElement.id || "",
            className: htmlElement.getAttribute("class") || "",
            ariaLabel,
            dataTestId: htmlElement.getAttribute("data-testid") || "",
          };
        }` as never,
      )
      .catch(() => undefined)) as
      | (RawReconElement & { visible: boolean })
      | undefined;

    await handle.dispose();
    if (!element?.visible) continue;

    elements.push({
      ...element,
      xpath: bestEffortXPath({ ...element, index }),
    });
  }

  return elements.map((element) => ({
    ...element,
    suggestedLocators: buildLocatorSuggestions(element),
  }));
}

function bestEffortXPath(input: {
  tag: string;
  id: string;
  name: string;
  placeholder: string;
  text: string;
  index: number;
}): string {
  if (input.id) return `//*[@id="${input.id}"]`;
  if (input.name) return `//${input.tag}[@name="${input.name}"]`;
  if (input.placeholder) {
    return `//${input.tag}[@placeholder="${input.placeholder}"]`;
  }
  if (input.text) {
    return `//${input.tag}[normalize-space()="${input.text}"]`;
  }
  return `//${input.tag}[${input.index + 1}]`;
}

async function captureRoleOptions(
  page: Page,
  _formRoot: Locator,
): Promise<string[]> {
  const roleControl = await firstVisibleLocator("Role dropdown", [
    page.getByText("Select role", { exact: true }),
    page.getByRole("combobox", { name: /role/i }),
    page.locator('[class*="role"]').getByText("Select role", {
      exact: true,
    }),
    page.locator(
      'xpath=//*[normalize-space()="Role"]/ancestor::*[contains(@class,"field") or contains(@class,"form")][1]//*[normalize-space()="Select role"]',
    ),
  ]);
  await roleControl.click();

  const panel = page
    .locator(
      [
        ".p-multiselect-panel",
        ".p-dropdown-panel",
        ".p-select-panel",
        '[role="listbox"]',
      ].join(", "),
    )
    .last();
  await panel.waitFor({ state: "visible", timeout: 5_000 });

  return panel
    .locator("li, [role='option'], [role='checkbox'], label, .p-multiselect-item")
    .evaluateAll((nodes) =>
      Array.from(
        new Set(
          nodes
            .map((node) => (node as HTMLElement).innerText?.trim())
            .filter(Boolean)
            .map((text) => text.replace(/\s+/g, " ")),
        ),
      ),
    );
}

function buildLocatorSuggestions(element: RawReconElement): string[] {
  const suggestions: string[] = [];
  const labelOrText =
    element.label || element.text || element.ariaLabel || element.placeholder;

  if (element.tag === "button" && element.text) {
    suggestions.push(
      `page.getByRole("button", { name: ${quote(element.text)} })`,
    );
  }
  if (element.role && labelOrText) {
    suggestions.push(
      `page.getByRole(${quote(element.role)}, { name: ${quote(labelOrText)} })`,
    );
  }
  if (element.label) {
    suggestions.push(`page.getByLabel(${quote(element.label)})`);
  }
  if (element.placeholder) {
    suggestions.push(`page.getByPlaceholder(${quote(element.placeholder)})`);
  }
  if (element.dataTestId) {
    suggestions.push(`page.getByTestId(${quote(element.dataTestId)})`);
  }
  if (element.name) {
    suggestions.push(
      `page.locator(${quote(`${element.tag}[name="${element.name}"]`)})`,
    );
  }
  if (element.type) {
    suggestions.push(
      `page.locator(${quote(`${element.tag}[type="${element.type}"]`)})`,
    );
  }
  suggestions.push(`page.locator(${quote(`xpath=${element.xpath}`)})`);

  return Array.from(new Set(suggestions));
}

function renderDomReconMarkdown(payload: ReconPayload): string {
  const lines = [
    "# DOM Recon: User Management Add User Form",
    "",
    `Scenario: ${payload.scenarioId}`,
    `Captured: ${payload.capturedAt}`,
    `URL: ${payload.url}`,
    `Screenshot: ${payload.screenshotPath || ""}`,
    "",
    "## Role Options",
    ...payload.roleOptions.map((option) => `- ${option}`),
    "",
    "## Locator Map",
  ];

  for (const element of payload.formElements) {
    const title =
      element.label ||
      element.placeholder ||
      element.text ||
      element.ariaLabel ||
      element.name ||
      element.tag;
    lines.push("");
    lines.push(`### ${element.tag}: ${title}`);
    lines.push(`- role: ${element.role || "(none)"}`);
    lines.push(`- label: ${element.label || "(none)"}`);
    lines.push(`- placeholder: ${element.placeholder || "(none)"}`);
    lines.push(`- text: ${element.text || "(none)"}`);
    lines.push(`- name: ${element.name || "(none)"}`);
    lines.push(`- type: ${element.type || "(none)"}`);
    lines.push(`- data-testid: ${element.dataTestId || "(none)"}`);
    lines.push("- suggested locators:");
    element.suggestedLocators.forEach((locator, index) => {
      lines.push(`  ${index + 1}. \`${locator}\``);
    });
  }

  return lines.join("\n");
}
