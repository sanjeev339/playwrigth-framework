import { chromium, Locator, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { LoginAction } from "../../../actions/auth/LoginAction";
import { quote, safeIdentifier } from "./names";
import { McpConfig } from "../config/McpConfig";

export type LocatorDiscoveryOptions = {
  scenarioId: string;
  featureName?: string;
  title?: string;
  description?: string;
  steps?: unknown;
  testData?: Record<string, string | number | boolean>;
  headed?: boolean;
  outputDir?: string;
};

export type LocatorDiscoveryResult = {
  ok: boolean;
  reason?: string;
  moduleKey?: string;
  screenKey?: string;
  markdown?: string;
  jsonPath?: string;
  markdownPath?: string;
  screenshotPath?: string;
};

export type UserResolutionResult = {
  ok: boolean;
  reason?: string;
  userId: string;
  resolved?: Record<string, string | number | boolean>;
  matchedUser?: Record<string, unknown>;
};

type DiscoveryTarget = {
  moduleKey: string;
  moduleLabel: string;
  screenKey: string;
  screenLabel: string;
  opensAddUserForm: boolean;
};

type AccessibleNode = {
  role: string;
  name: string;
  value: string;
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

type TableSnapshot = {
  index: number;
  headers: string[];
  rows: string[];
};

type LocatorRegistryPayload = {
  scenarioId: string;
  moduleKey: string;
  moduleLabel: string;
  screenKey: string;
  screenLabel: string;
  capturedAt: string;
  url: string;
  title: string;
  accessibilityTree: AccessibleNode[];
  interactiveElements: ReconElement[];
  tables: TableSnapshot[];
  roleOptions: string[];
  screenshotPath?: string;
};

const repoRoot = process.cwd();

export async function discoverLocatorEvidence(
  options: LocatorDiscoveryOptions,
): Promise<LocatorDiscoveryResult> {
  const target = detectDiscoveryTarget(options);
  const outputRoot =
    options.outputDir || path.join(repoRoot, "generated_output", "locator-registry");
  const registryDir = path.join(outputRoot, target.moduleKey);
  fs.mkdirSync(registryDir, { recursive: true });

  const jsonPath = path.join(registryDir, `${target.screenKey}.json`);
  const markdownPath = path.join(registryDir, `${target.screenKey}.md`);
  if (fs.existsSync(jsonPath) && fs.existsSync(markdownPath)) {
    return {
      ok: true,
      moduleKey: target.moduleKey,
      screenKey: target.screenKey,
      jsonPath,
      markdownPath,
      markdown: fs.readFileSync(markdownPath, "utf-8"),
    };
  }

  const browser = await chromium.launch({ headless: options.headed === false });
  const page = await browser.newPage();

  try {
    await loginAndOpenModule(page, target.moduleLabel);

    if (target.opensAddUserForm) {
      await openUserManagementAddInternalUserForm(page);
    }

    const screenshotPath = path.join(registryDir, `${target.screenKey}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const payload: LocatorRegistryPayload = {
      scenarioId: options.scenarioId,
      moduleKey: target.moduleKey,
      moduleLabel: target.moduleLabel,
      screenKey: target.screenKey,
      screenLabel: target.screenLabel,
      capturedAt: new Date().toISOString(),
      url: page.url(),
      title: await page.title(),
      accessibilityTree: await captureAccessibilityTree(page),
      interactiveElements: await extractInteractiveElements(page.locator("body")),
      tables: await captureTables(page),
      roleOptions: target.opensAddUserForm ? await captureRoleOptions(page) : [],
      screenshotPath,
    };

    const markdown = renderLocatorRegistryMarkdown(payload);
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
    fs.writeFileSync(markdownPath, markdown);

    return {
      ok: true,
      moduleKey: target.moduleKey,
      screenKey: target.screenKey,
      jsonPath,
      markdownPath,
      markdown,
      screenshotPath,
    };
  } catch (error) {
    return {
      ok: false,
      moduleKey: target.moduleKey,
      screenKey: target.screenKey,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await browser.close();
  }
}

export async function resolveUserVisibleIdentifierFromPortal(options: {
  userId: string;
  headed?: boolean;
  outputDir?: string;
}): Promise<UserResolutionResult> {
  const userId = String(options.userId || "").trim();
  if (!userId) {
    return { ok: false, userId, reason: "missing_user_id" };
  }

  const browser = await chromium.launch({ headless: options.headed === false });
  const page = await browser.newPage();
  let discoveredUserListApiUrl = "";
  const userListApiRegex = new RegExp(
    McpConfig.discovery.userListApiPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b",
    "i"
  );
  let discoveredUserListHeaders: Record<string, string> = {};
  page.on("request", (request) => {
    const url = request.url();
    if (userListApiRegex.test(url)) {
      discoveredUserListHeaders = headersForReplay(request.headers());
    }
  });
  page.on("response", (response) => {
    const url = response.url();
    if (userListApiRegex.test(url)) {
      discoveredUserListApiUrl = url;
    }
  });

  try {
    await loginAndOpenModule(page, "User Management");
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const apiUrl =
      discoveredUserListApiUrl || inferUserListApiUrlFromPortalUrl(page.url());

    for (let pageNo = 0; pageNo < McpConfig.discovery.userListMaxPages; pageNo += 1) {
      const response = await page.request.post(apiUrl, {
        headers: discoveredUserListHeaders,
        data: {
          pageNo,
          pageSize: McpConfig.discovery.userListPageSize,
          searchText: "",
          statuses: [],
          roleIds: [],
          startDate: "",
          endDate: "",
          creationType: "",
          userType: McpConfig.discovery.userType,
          organisationId: null,
        },
      });

      if (!response.ok()) {
        return {
          ok: false,
          userId,
          reason: `user_list_api_failed_${response.status()}`,
        };
      }

      const json = (await response.json().catch(() => undefined)) as unknown;
      const users = extractUserRecords(json);
      const matched = users.find((user) => String(user.uuid || user.id) === userId);
      if (matched) {
        const resolved = userRecordToVisibleTestData(matched);
        writeUserResolution(options.outputDir, userId, matched, resolved);
        return {
          ok: true,
          userId,
          matchedUser: matched,
          resolved,
        };
      }

      if (!users.length) break;
    }

    return {
      ok: false,
      userId,
      reason: "uuid_not_found_in_user_list",
    };
  } catch (error) {
    return {
      ok: false,
      userId,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await browser.close();
  }
}

function headersForReplay(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([key]) => !/^(host|content-length|connection)$/i.test(key),
    ),
  );
}

function inferUserListApiUrlFromPortalUrl(portalUrl: string): string {
  const url = new URL(portalUrl);
  if (url.hostname.startsWith("adminportal.")) {
    url.hostname = url.hostname.replace(/^adminportal\./, "api.");
  }
  url.pathname = McpConfig.discovery.userListApiPath;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function detectDiscoveryTarget(options: LocatorDiscoveryOptions): DiscoveryTarget {
  const text = [
    options.scenarioId,
    options.featureName,
    options.title,
    options.description,
    JSON.stringify(options.steps || ""),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const moduleMatchRegex = new RegExp(McpConfig.discovery.moduleMatchRegex, "i");
  const opensAddUserFormRegex = new RegExp(McpConfig.discovery.opensAddUserFormRegex, "i");

  const isUserManagement = moduleMatchRegex.test(text);
  const moduleLabel = isUserManagement
    ? "User Management"
    : inferModuleLabel(options.featureName || options.title || "Dashboard");
  const moduleKey = safeIdentifier(moduleLabel, "module").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  const opensAddUserForm = isUserManagement && opensAddUserFormRegex.test(text);

  return {
    moduleKey,
    moduleLabel,
    screenKey: opensAddUserForm ? "add-internal-user-form" : "list-screen",
    screenLabel: opensAddUserForm
      ? `${moduleLabel} Add Internal User Form`
      : `${moduleLabel} List Screen`,
    opensAddUserForm,
  };
}

function inferModuleLabel(value: string): string {
  return value
    .replace(/\bTC-[A-Z]+-\d+\b/gi, "")
    .replace(/\s+/g, " ")
    .trim() || "Dashboard";
}

async function loginAndOpenModule(page: Page, moduleLabel: string): Promise<void> {
  const loginAction = new LoginAction(page);
  await loginAction.loginAndWaitForLoad();
  if (/dashboard/i.test(moduleLabel)) return;

  await clickFirstVisible(page, `${moduleLabel} navigation`, [
    page.getByRole("button", { name: new RegExp(`^${escapeRegex(moduleLabel)}$`, "i") }),
    page.getByRole("link", { name: new RegExp(`^${escapeRegex(moduleLabel)}$`, "i") }),
    page.getByRole("menuitem", { name: new RegExp(`^${escapeRegex(moduleLabel)}$`, "i") }),
    page.getByText(moduleLabel, { exact: true }),
    page.locator('[class*="sidebar"]').getByText(moduleLabel, { exact: true }),
    page.locator(
      `xpath=//*[contains(@class,"sidebar") or contains(@class,"menu")]//*[normalize-space()="${escapeXpathDouble(moduleLabel)}"]`,
    ),
  ]);
}

async function openUserManagementAddInternalUserForm(page: Page): Promise<void> {
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
    `Locator discovery could not find a visible locator for ${purpose}. Tried ${candidates.length} candidates.`,
  );
}

async function captureAccessibilityTree(page: Page): Promise<AccessibleNode[]> {
  const client = await page.context().newCDPSession(page);
  try {
    const result = (await client.send("Accessibility.getFullAXTree")) as {
      nodes?: Array<{
        ignored?: boolean;
        role?: { value?: string };
        name?: { value?: string };
        value?: { value?: string };
      }>;
    };
    return (result.nodes || [])
      .filter((node) => !node.ignored)
      .map((node) => ({
        role: String(node.role?.value || ""),
        name: String(node.name?.value || ""),
        value: String(node.value?.value || ""),
      }))
      .filter((node) => node.role || node.name || node.value)
      .slice(0, 250);
  } finally {
    await client.detach().catch(() => undefined);
  }
}

async function extractInteractiveElements(root: Locator): Promise<ReconElement[]> {
  const handles = await root
    .locator(
      [
        "input",
        "textarea",
        "select",
        "button",
        "a",
        "label",
        "[role]",
        "[placeholder]",
        "[data-testid]",
      ].join(", "),
    )
    .elementHandles();

  const elements: ReconElement[] = [];
  for (const [index, handle] of handles.entries()) {
    const element = (await handle
      .evaluate(
        `element => {
          const htmlElement = element;
          const rect = htmlElement.getBoundingClientRect();
          const text = (htmlElement.innerText || htmlElement.textContent || "")
            .trim()
            .replace(/\\s+/g, " ")
            .slice(0, 160);
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
      | (Omit<ReconElement, "xpath" | "suggestedLocators"> & { visible: boolean })
      | undefined;

    await handle.dispose();
    if (!element?.visible) continue;

    const raw = {
      ...element,
      xpath: bestEffortXPath({ ...element, index }),
    };
    elements.push({
      ...raw,
      suggestedLocators: buildLocatorSuggestions(raw),
    });
  }

  return elements.slice(0, 180);
}

async function captureTables(page: Page): Promise<TableSnapshot[]> {
  return page.locator("table").evaluateAll((tables) =>
    tables.slice(0, 5).map((table, index) => {
      const headers = Array.from(table.querySelectorAll("th"))
        .map((node) => (node.textContent || "").trim().replace(/\s+/g, " "))
        .filter(Boolean);
      const rows = Array.from(table.querySelectorAll("tbody tr, tr"))
        .slice(0, 20)
        .map((row) => (row.textContent || "").trim().replace(/\s+/g, " "))
        .filter(Boolean);
      return { index, headers, rows };
    }),
  );
}

async function captureRoleOptions(page: Page): Promise<string[]> {
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
    .locator(McpConfig.discovery.dropdownPanelSelectors.join(", "))
    .last();
  await panel.waitFor({ state: "visible", timeout: 5_000 });

  return panel
    .locator(McpConfig.discovery.dropdownOptionSelectors)
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

function buildLocatorSuggestions(element: Omit<ReconElement, "suggestedLocators">): string[] {
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
  if (element.label && element.tag !== "label") {
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

function renderLocatorRegistryMarkdown(payload: LocatorRegistryPayload): string {
  const lines = [
    `# Locator Registry: ${payload.screenLabel}`,
    "",
    `Scenario: ${payload.scenarioId}`,
    `Module: ${payload.moduleLabel}`,
    `Screen: ${payload.screenLabel}`,
    `Captured: ${payload.capturedAt}`,
    `URL: ${payload.url}`,
    `Screenshot: ${payload.screenshotPath || ""}`,
    "",
    "## Accessibility Tree Highlights",
  ];

  for (const node of payload.accessibilityTree.slice(0, 80)) {
    lines.push(
      `- role=${node.role || "(none)"} name=${node.name || "(none)"} value=${node.value || "(none)"}`,
    );
  }

  lines.push("", "## Role Options");
  if (payload.roleOptions.length) {
    payload.roleOptions.forEach((option) => lines.push(`- ${option}`));
  } else {
    lines.push("- (none captured)");
  }

  lines.push("", "## Tables");
  if (payload.tables.length) {
    for (const table of payload.tables) {
      lines.push(`### table ${table.index + 1}`);
      lines.push(`- headers: ${table.headers.join(" | ") || "(none)"}`);
      table.rows.slice(0, 10).forEach((row) => lines.push(`- row: ${row}`));
    }
  } else {
    lines.push("- (none captured)");
  }

  lines.push("", "## Interactive Locator Map");
  for (const element of payload.interactiveElements) {
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

function bestEffortXPath(input: {
  tag: string;
  id: string;
  name: string;
  placeholder: string;
  text: string;
  index: number;
}): string {
  if (input.id) return `//*[@id="${escapeXpathDouble(input.id)}"]`;
  if (input.name) return `//${input.tag}[@name="${escapeXpathDouble(input.name)}"]`;
  if (input.placeholder) {
    return `//${input.tag}[@placeholder="${escapeXpathDouble(input.placeholder)}"]`;
  }
  if (input.text) {
    return `//${input.tag}[normalize-space()="${escapeXpathDouble(input.text)}"]`;
  }
  return `//${input.tag}[${input.index + 1}]`;
}

function extractUserRecords(value: unknown): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      if (
        node.some(
          (item) =>
            item &&
            typeof item === "object" &&
            ("uuid" in item || "email" in item || "firstName" in item),
        )
      ) {
        records.push(
          ...node.filter(
            (item): item is Record<string, unknown> =>
              Boolean(item) && typeof item === "object" && !Array.isArray(item),
          ),
        );
        return;
      }
      node.forEach(visit);
      return;
    }

    if (node && typeof node === "object") {
      Object.values(node).forEach(visit);
    }
  };

  visit(value);
  return records;
}

function userRecordToVisibleTestData(
  user: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const firstName = primitive(user.firstName);
  const lastName = primitive(user.lastName);
  const emailAddress = primitive(user.email || user.emailAddress);
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const status = primitive(user.status);
  const role = Array.isArray(user.roles)
    ? user.roles
        .map((roleRecord) =>
          typeof roleRecord === "object" && roleRecord
            ? primitive((roleRecord as Record<string, unknown>).name)
            : primitive(roleRecord),
        )
        .filter(Boolean)
        .join(", ")
    : primitive(user.role);

  return Object.fromEntries(
    Object.entries({
      emailAddress,
      firstName,
      lastName,
      fullName,
      status,
      existingUserVisibleIdentifier: emailAddress || fullName,
      resolvedVisibleUserIdentifier: emailAddress || fullName,
      currentRole: role,
    }).filter(([, value]) => value !== ""),
  ) as Record<string, string | number | boolean>;
}

function primitive(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function writeUserResolution(
  outputDir: string | undefined,
  userId: string,
  matchedUser: Record<string, unknown>,
  resolved: Record<string, string | number | boolean>,
): void {
  const root =
    outputDir || path.join(repoRoot, "generated_output", "locator-registry");
  const dir = path.join(root, "user-management");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `resolved-user-${safeIdentifier(userId, "user")}.json`),
    JSON.stringify({ userId, matchedUser, resolved }, null, 2),
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeXpathDouble(value: string): string {
  return value.replace(/"/g, '\\"');
}
