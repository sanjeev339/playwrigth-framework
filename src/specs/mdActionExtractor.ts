import path from 'node:path';
import fs from 'fs-extra';
import type { ActionType } from '../recon/reconDecisionTypes';
import type { Scenario } from '../types';
import { resolvePayloadIdentity } from '../scenario/payloadIdentityResolver';
import { listFiles, readJsonFile, readTextFile, resolveFromRoot, toSafeFileName, writeJsonFile } from '../utils/fileUtils';
import { logger } from '../utils/logger';

export interface ScenarioAtomicAction {
  stepNo: number;
  sourceStepTitle: string;
  rawActionText: string;
  actionType: ActionType;
  target: string | null;
  value: string | null;
  payloadKey: string | null;
  assertionHint: string | null;
}

interface ExtractedScenarioActions {
  scenarioId: string;
  file: string;
  actions: ScenarioAtomicAction[];
}

interface StepSection {
  sourceStepNo: number;
  title: string;
  lines: string[];
}

interface ActionExtractionWarning {
  scenario_id: string;
  stepNo?: number;
  severity: 'low' | 'medium' | 'high';
  rule: string;
  message: string;
  rawActionText?: string;
  target?: string | null;
}

interface ActionExtractionValidationReport {
  generated_at: string;
  scenarios: Array<{
    scenario_id: string;
    action_file: string;
    action_count: number;
    warnings: ActionExtractionWarning[];
  }>;
  warnings: ActionExtractionWarning[];
}

const secretKeyPattern = /(password|passcode|secret|token|jwt|cookie|authorization|api[_-]?key|username|login_email|loginemail)/i;
const executableActionTypes = new Set<ActionType>(['navigate', 'click', 'fill', 'select', 'verify', 'wait', 'row_action']);

export async function extractMarkdownActions(options: {
  specsDir?: string;
  scenarioDir?: string;
  outputDir?: string;
  reportPath?: string;
  scenarioIds?: string[];
} = {}): Promise<ExtractedScenarioActions[]> {
  const specsDir = options.specsDir ?? resolveFromRoot('specs');
  const scenarioDir = options.scenarioDir ?? resolveFromRoot('scenarios');
  const outputDir = options.outputDir ?? resolveFromRoot('scenario-actions');
  const reportPath = options.reportPath ?? resolveFromRoot('reports', 'action-extraction-validation.json');
  const requestedScenarioIds = new Set((options.scenarioIds ?? []).map(toSafeFileName));
  const specFiles = (await listFiles(specsDir, '.md')).filter((file) => {
    if (requestedScenarioIds.size === 0) {
      return true;
    }

    return requestedScenarioIds.has(path.basename(file, '.md'));
  });
  const extracted: ExtractedScenarioActions[] = [];
  const reportScenarios: ActionExtractionValidationReport['scenarios'] = [];
  const allWarnings: ActionExtractionWarning[] = [];

  await fs.ensureDir(outputDir);

  for (const specFile of specFiles) {
    const safeScenarioId = path.basename(specFile, '.md');
    const scenarioPath = path.join(scenarioDir, `${safeScenarioId}.json`);

    if (!(await fs.pathExists(scenarioPath))) {
      const warning: ActionExtractionWarning = {
        scenario_id: safeScenarioId,
        severity: 'high',
        rule: 'missing-scenario',
        message: `No matching scenario JSON found for ${path.relative(process.cwd(), specFile)}.`
      };
      allWarnings.push(warning);
      continue;
    }

    const [markdown, scenario] = await Promise.all([
      readTextFile(specFile),
      readJsonFile<Scenario>(scenarioPath)
    ]);
    const actions = extractScenarioActionsFromMarkdown(markdown, scenario);
    const outputPath = path.join(outputDir, `${safeScenarioId}.actions.json`);
    const warnings = validateExtractedActions(scenario.scenario_id, actions);

    await writeJsonFile(outputPath, actions);
    extracted.push({
      scenarioId: scenario.scenario_id,
      file: outputPath,
      actions
    });
    reportScenarios.push({
      scenario_id: scenario.scenario_id,
      action_file: path.relative(process.cwd(), outputPath),
      action_count: actions.length,
      warnings
    });
    allWarnings.push(...warnings);
    logger.info(`Extracted ${actions.length} atomic action(s) -> ${outputPath}`);
  }

  const report: ActionExtractionValidationReport = {
    generated_at: new Date().toISOString(),
    scenarios: reportScenarios,
    warnings: allWarnings
  };
  await writeJsonFile(reportPath, report);
  logger.info(`Wrote action extraction validation report -> ${reportPath}`);
  return extracted;
}

export async function ensureScenarioActions(input: {
  scenario: Scenario;
  specsDir?: string;
  scenarioDir?: string;
  outputDir?: string;
}): Promise<ScenarioAtomicAction[]> {
  const outputDir = input.outputDir ?? resolveFromRoot('scenario-actions');
  const safeScenarioId = toSafeFileName(input.scenario.scenario_id);
  const actionPath = path.join(outputDir, `${safeScenarioId}.actions.json`);

  if (!(await fs.pathExists(actionPath))) {
    await extractMarkdownActions({
      specsDir: input.specsDir,
      scenarioDir: input.scenarioDir,
      outputDir,
      scenarioIds: [input.scenario.scenario_id]
    });
  }

  if (await fs.pathExists(actionPath)) {
    return readJsonFile<ScenarioAtomicAction[]>(actionPath);
  }

  return [];
}

export function extractScenarioActionsFromMarkdown(markdown: string, scenario: Scenario): ScenarioAtomicAction[] {
  const sections = parseStepSections(markdown);
  const payload = sanitizePayload(scenario.payload);
  const extractedActions: Omit<ScenarioAtomicAction, 'stepNo'>[] = [];

  for (const section of sections) {
    if (isLoginSection(section.title)) {
      continue;
    }

    const assertionHint = extractAssertionHint(section.lines);
    const actionLines = extractActionLines(section.lines);
    const executableLines = actionLines.length ? actionLines : [section.title].filter((title) => executableActionTypes.has(detectActionType(title, section.title, payload)));

    for (const actionText of executableLines) {
      if (shouldSkipActionText(section.title, actionText)) {
        continue;
      }

      extractedActions.push(
        ...extractAtomicActionsFromText({
          sourceStepTitle: section.title,
          rawActionText: actionText,
          assertionHint,
          payload
        })
      );
    }
  }

  if (extractedActions.length === 0) {
    extractedActions.push(
      ...scenario.steps.map((step) => ({
        sourceStepTitle: step.instruction,
        rawActionText: step.instruction,
        actionType: detectActionType(step.instruction, step.instruction, payload),
        target: cleanTarget(step.instruction.replace(/^(navigate|go to|click|enter|fill|type|select|choose|verify|check|assert|wait)\b/i, '')),
        value: null,
        payloadKey: null,
        assertionHint: step.expected_result ?? null
      }))
    );
  }

  return extractedActions.map((action, index) => ({
    stepNo: index + 1,
    ...action
  }));
}

function parseStepSections(markdown: string): StepSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: StepSection[] = [];
  let current: StepSection | null = null;

  for (const line of lines) {
    const heading = line.match(/^\s*#{2,6}\s*(?:step\s*)?(\d+)[\).:\-]?\s*(.+?)\s*$/i);
    if (heading?.[1]) {
      if (current) {
        sections.push(current);
      }

      current = {
        sourceStepNo: Number(heading[1]),
        title: cleanMarkdownText(heading[2]).replace(/\.$/, ''),
        lines: []
      };
      continue;
    }

    if (/^\s*#{1,6}\s+/.test(line) && current) {
      sections.push(current);
      current = null;
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    sections.push(current);
  }

  return sections;
}

function extractActionLines(lines: string[]): string[] {
  return lines
    .map((line) => {
      const match = line.match(/^\s*(?:(?:[-*+])|\d+\.)\s*(?:\*\*)?\s*Action\s*(?:\*\*)?\s*:\s*(.+)$/i);
      return match?.[1] ? cleanMarkdownText(match[1]) : null;
    })
    .filter((line): line is string => Boolean(line));
}

function extractAssertionHint(lines: string[]): string | null {
  const hints: string[] = [];
  let capture = false;

  for (const line of lines) {
    const actionLine = /^\s*(?:(?:[-*+])|\d+\.)\s*(?:\*\*)?\s*Action\s*(?:\*\*)?\s*:/i.test(line);
    if (actionLine && capture) {
      break;
    }
    if (capture && /^\s*#{1,6}\s+/.test(line)) {
      break;
    }
    if (capture && /notes?\s+for\s+dynamic|reconnaissance/i.test(line)) {
      break;
    }

    const assertionMatch = line.match(/^\s*(?:(?:[-*+])|\d+\.)?\s*(?:\*\*)?\s*Assertions?\s*(?:\*\*)?\s*:?\s*(.*)$/i);
    if (assertionMatch) {
      capture = true;
      const inlineHint = cleanMarkdownText(assertionMatch[1] ?? '');
      if (inlineHint) {
        hints.push(inlineHint);
      }
      continue;
    }

    if (capture) {
      const cleaned = cleanMarkdownText(line);
      if (cleaned && !/^notes?\b/i.test(cleaned)) {
        hints.push(cleaned);
      }
    }
  }

  return hints.length ? hints.join(' ') : null;
}

function extractAtomicActionsFromText(input: {
  sourceStepTitle: string;
  rawActionText: string;
  assertionHint: string | null;
  payload: Record<string, string>;
}): Array<Omit<ScenarioAtomicAction, 'stepNo'>> {
  const text = cleanMarkdownText(input.rawActionText);
  if (isLocateOnlyAction(text)) {
    return [];
  }

  const actionType = detectActionType(text, input.sourceStepTitle, input.payload);

  if (actionType === 'row_action') {
    const rowAction = buildRowAction(input.sourceStepTitle, text, input.payload, input.assertionHint);
    return rowAction ? rowAction : [];
  }

  if (actionType === 'fill') {
    return buildFillActions(input.sourceStepTitle, text, input.payload, input.assertionHint);
  }

  if (actionType === 'select') {
    return buildSelectOrClickAction(input.sourceStepTitle, text, input.payload, input.assertionHint);
  }

  if (actionType === 'navigate') {
    const target = targetFromTitle(input.sourceStepTitle, 'navigate') ?? targetFromNavigateText(text);
    return [createAction(input.sourceStepTitle, text, 'navigate', target, null, null, input.assertionHint)];
  }

  if (actionType === 'click') {
    const target = targetFromTitle(input.sourceStepTitle, 'click') ?? targetFromClickText(text);
    return [createAction(input.sourceStepTitle, text, 'click', target, null, null, input.assertionHint)];
  }

  if (actionType === 'verify') {
    return [createAction(input.sourceStepTitle, text, 'verify', cleanTarget(text), null, null, input.assertionHint)];
  }

  if (actionType === 'wait') {
    return [createAction(input.sourceStepTitle, text, 'wait', null, null, null, input.assertionHint)];
  }

  return [createAction(input.sourceStepTitle, text, 'unknown', null, null, null, input.assertionHint)];
}

function buildFillActions(
  sourceStepTitle: string,
  rawActionText: string,
  payload: Record<string, string>,
  assertionHint: string | null
): Array<Omit<ScenarioAtomicAction, 'stepNo'>> {
  const fieldTargets = fieldTargetsFromFillText(rawActionText);
  const keys = fieldTargets.length ? [] : payloadKeysInText(rawActionText, payload);
  const targets = fieldTargets.length ? fieldTargets : keys;
  const uniqueTargets = dedupe(targets);

  return uniqueTargets.map((target) => {
    const payloadKey = findPayloadKey(target, payload) ?? findPayloadKeyByValue(rawActionText, payload);
    return createAction(
      sourceStepTitle,
      rawActionText,
      'fill',
      payloadKey ?? cleanTarget(target),
      payloadKey ? payload[payloadKey] : extractedLiteralValue(rawActionText),
      payloadKey,
      assertionHint
    );
  });
}

function buildSelectOrClickAction(
  sourceStepTitle: string,
  rawActionText: string,
  payload: Record<string, string>,
  assertionHint: string | null
): Array<Omit<ScenarioAtomicAction, 'stepNo'>> {
  const payloadKey = findPayloadKey(rawActionText, payload) ?? findPayloadKey(sourceStepTitle, payload);
  const quotedTargets = quotedValues(rawActionText);
  const hasDropdownCue = /\b(dropdown|select\s+(?:field|list|box)|combobox|from\s+the\s+.+?\s+(?:dropdown|list))\b/i.test(rawActionText);

  if (!hasDropdownCue && !payloadKey) {
    const target = quotedTargets[0] ?? targetFromSelectText(rawActionText);
    return [createAction(sourceStepTitle, rawActionText, 'click', cleanTarget(target), null, null, assertionHint)];
  }

  const target =
    payloadKey ??
    targetFromDropdownText(rawActionText) ??
    targetFromTitle(sourceStepTitle, 'select') ??
    cleanTarget(targetFromSelectText(rawActionText));
  const optionValue = payloadKey ? payload[payloadKey] : quotedTargets[0] ?? null;

  return [createAction(sourceStepTitle, rawActionText, 'select', target, optionValue, payloadKey, assertionHint)];
}

function buildRowAction(
  sourceStepTitle: string,
  rawActionText: string,
  payload: Record<string, string>,
  assertionHint: string | null
): Array<Omit<ScenarioAtomicAction, 'stepNo'>> | null {
  const identity = resolvePayloadIdentity(payload);
  const identityValue = identity?.identityValue ?? quotedValues(rawActionText).find((value) => isIdentityValue(value));
  if (!identityValue) {
    return null;
  }

  const actions: Array<Omit<ScenarioAtomicAction, 'stepNo'>> = [
    createAction(
      sourceStepTitle,
      rawActionText,
      'row_action',
      `Actions Menu for ${identityValue}`,
      null,
      identity?.identityKey ?? null,
      assertionHint
    )
  ];
  const followUpAction = explicitRowFollowUpAction(rawActionText, sourceStepTitle);

  if (followUpAction && /edit|delete|remove|approve|reject|disable|enable/i.test(followUpAction)) {
    actions.push(createAction(sourceStepTitle, rawActionText, 'click', followUpAction, null, null, assertionHint));
  }

  return actions;
}

function detectActionType(rawActionText: string, sourceStepTitle: string, payload: Record<string, string>): ActionType {
  const text = cleanMarkdownText(rawActionText).toLowerCase();
  const title = cleanMarkdownText(sourceStepTitle).toLowerCase();

  if (isRowActionText(text, title, payload)) return 'row_action';
  if (/^(navigate|go)\s+to\b/.test(text) || /^navigate\b/.test(title)) return 'navigate';
  if (/^(enter|fill|type|input)\b/.test(text) || /^(enter|fill|type|input)\b/.test(title)) return 'fill';
  if (/^(select|choose)\b/.test(text) || /^(select|choose)\b/.test(title)) return 'select';
  if (/^click\b/.test(text) || /^click\b/.test(title)) return 'click';
  if (/^(verify|check|assert|confirm)\b/.test(text) || /^(verify|check|assert|confirm)\b/.test(title)) return 'verify';
  if (/\bwait\b/.test(text) || /\bwait\b/.test(title)) return 'wait';
  return 'unknown';
}

function isRowActionText(text: string, title: string, payload: Record<string, string>): boolean {
  const identity = resolvePayloadIdentity(payload);
  const hasIdentity = Boolean(identity?.identityValue && normalize(text).includes(normalize(identity.identityValue)));
  const hasRowCue = /\b(row|record|table|list|associated|customer|user|license|employee|account|entry|profile)\b/i.test(text);
  const hasMenuCue = /\b(menu|actions?|more|associated)\b/i.test(text);
  const hasActionCue = /\b(click|select|choose|edit|delete|remove|view|details|open)\b/i.test(text);
  const refersToIdentifiedRow = Boolean(identity?.identityValue && /\bidentified\b|\bassociated\b/i.test(text));
  const genericRecordSelection =
    Boolean(identity?.identityValue) &&
    (isGenericRowSelectionText(text) || isGenericRowSelectionText(title)) &&
    !/\b(details?\s+page|profile\s+page|form|modal|button|dropdown)\b/i.test(text);

  return (
    genericRecordSelection ||
    ((hasIdentity || refersToIdentifiedRow) && hasRowCue && hasActionCue && (hasMenuCue || /\bassociated\b|\bidentified\b/i.test(text)))
  );
}

function isGenericRowSelectionText(text: string): boolean {
  return /\b(?:click|select|choose|open|locate)\s+(?:on\s+)?(?:the\s+)?(?:identified\s+)?(?:user|customer|record|row|item|license|employee|member|account|entry|profile)\b/i.test(
    text
  );
}

function isLocateOnlyAction(text: string): boolean {
  return /\b(locate|find|identify)\b/i.test(text) && !/\b(click|select|choose|open)\b/i.test(text);
}

function targetFromTitle(title: string, actionType: 'navigate' | 'click' | 'select'): string | null {
  const pattern =
    actionType === 'navigate'
      ? /^(?:navigate|go)\s+(?:to\s+)?(.+)$/i
      : actionType === 'select'
        ? /^(?:select|choose)\s+(.+)$/i
        : /^click\s+(?:on\s+)?(.+)$/i;
  const match = title.match(pattern);
  return match?.[1] ? cleanTarget(match[1]) : null;
}

function targetFromNavigateText(text: string): string | null {
  const quoted = quotedValues(text)[0];
  if (quoted) return cleanTarget(quoted);
  const match = text.match(/\b(?:navigate|go)\s+(?:to\s+)?(?:the\s+)?(.+?)(?:\s+via\b|\s+from\b|$)/i);
  return match?.[1] ? cleanTarget(match[1]) : cleanTarget(text);
}

function targetFromClickText(text: string): string | null {
  const quoted = quotedValues(text).find((value) => !isIdentityValue(value)) ?? quotedValues(text)[0];
  if (quoted) return cleanTarget(quoted);
  const match = text.match(/\bclick\s+(?:on\s+)?(?:the\s+)?(.+?)(?:\s+(?:button|link|menu item|navigation link)\b|$)/i);
  return match?.[1] ? cleanTarget(match[1]) : cleanTarget(text);
}

function targetFromSelectText(text: string): string | null {
  const quoted = quotedValues(text)[0];
  if (quoted) return cleanTarget(quoted);
  const match = text.match(/\b(?:select|choose)\s+(?:the\s+)?(.+?)(?:\s+from\b|\s+dropdown\b|$)/i);
  return match?.[1] ? cleanTarget(match[1]) : cleanTarget(text);
}

function targetFromDropdownText(text: string): string | null {
  const quoted = quotedValues(text);
  if (quoted.length > 1) {
    return cleanTarget(quoted[1]);
  }

  const fromMatch = text.match(/\bfrom\s+(?:the\s+)?(?:["'`])?(.+?)(?:["'`])?\s+(?:dropdown|select|list|field)\b/i);
  if (fromMatch?.[1]) {
    return cleanTarget(fromMatch[1]);
  }

  const fieldMatch = text.match(/\b(.+?)\s+(?:dropdown|select|list|field)\b/i);
  return fieldMatch?.[1] ? cleanTarget(fieldMatch[1]) : null;
}

function fieldTargetsFromFillText(text: string): string[] {
  const targets: string[] = [];
  const intoPattern = /\b(?:into|in)\s+(?:the\s+)?(?:["'`])?(.+?)(?:["'`])?\s+(?:field|input|textbox)\b/gi;
  let match: RegExpExecArray | null;

  while ((match = intoPattern.exec(text)) !== null) {
    if (match[1]) {
      const target = cleanTarget(match[1]);
      if (target) {
        targets.push(target);
      }
    }
  }

  if (targets.length === 0) {
    const fallback = text.match(/^(?:enter|fill|type|input)\s+(?:the\s+)?(.+)$/i);
    if (fallback?.[1]) {
      const target = cleanTarget(fallback[1]);
      if (target) {
        targets.push(target);
      }
    }
  }

  return targets.filter((target): target is string => Boolean(target));
}

function payloadKeysInText(text: string, payload: Record<string, string>): string[] {
  const keys = Object.keys(payload).filter((key) => !secretKeyPattern.test(key));
  const normalizedText = normalize(text);
  const matched = keys.filter((key) => {
    const normalizedKey = normalize(key);
    const normalizedValue = normalize(payload[key]);
    return normalizedText.includes(normalizedKey) || (normalizedValue.length > 2 && normalizedText.includes(normalizedValue));
  });

  return matched.sort((left, right) => text.indexOf(payload[left]) - text.indexOf(payload[right]));
}

function findPayloadKey(text: string, payload: Record<string, string>): string | null {
  const normalizedText = normalize(text);
  const keys = Object.keys(payload).filter((key) => !secretKeyPattern.test(key));
  const direct = keys.find((key) => normalizedText.includes(normalize(key)));
  if (direct) return direct;

  const alias = keys.find((key) => aliasesForKey(key).some((candidate) => normalizedText.includes(normalize(candidate))));
  if (alias) return alias;

  return keys.find((key) => normalize(key).includes(normalizedText) || normalizedText.includes(normalize(key))) ?? null;
}

function findPayloadKeyByValue(text: string, payload: Record<string, string>): string | null {
  const normalizedText = normalize(text);
  return (
    Object.keys(payload)
      .filter((key) => !secretKeyPattern.test(key))
      .find((key) => {
        const normalizedValue = normalize(payload[key]);
        return normalizedValue.length > 2 && normalizedText.includes(normalizedValue);
      }) ?? null
  );
}

function aliasesForKey(key: string): string[] {
  const normalizedKey = normalize(key);
  const aliases: string[] = [];

  if (/email/.test(normalizedKey)) aliases.push('email', 'email address', 'mail');
  if (/username/.test(normalizedKey)) aliases.push('username', 'user name');
  if (/phone/.test(normalizedKey)) aliases.push('phone', 'phone number');
  if (/mobile/.test(normalizedKey)) aliases.push('mobile', 'mobile number');
  if (/status/.test(normalizedKey)) aliases.push('status');
  if (/role/.test(normalizedKey)) aliases.push('role');
  if (/name/.test(normalizedKey)) aliases.push(key.replace(/\s+/g, ' '));

  return aliases;
}

function explicitRowFollowUpAction(rawActionText: string, sourceStepTitle: string): string | null {
  const text = `${rawActionText} ${sourceStepTitle}`;
  const quoted = quotedValues(text).find((value) => /edit|delete|remove|view|details|open/i.test(value));
  if (quoted) {
    return cleanTarget(quoted.replace(/\//g, ' '));
  }

  const match = text.match(/\b(edit|delete|remove|view|details|open)\b/i);
  return match?.[1] ? cleanTarget(match[1]) : null;
}

function createAction(
  sourceStepTitle: string,
  rawActionText: string,
  actionType: ActionType,
  target: string | null,
  value: string | null,
  payloadKey: string | null,
  assertionHint: string | null
): Omit<ScenarioAtomicAction, 'stepNo'> {
  return {
    sourceStepTitle,
    rawActionText,
    actionType,
    target: normalizeNullable(target),
    value: normalizeNullable(value),
    payloadKey: normalizeNullable(payloadKey),
    assertionHint: normalizeNullable(assertionHint)
  };
}

function validateExtractedActions(scenarioId: string, actions: ScenarioAtomicAction[]): ActionExtractionWarning[] {
  const warnings: ActionExtractionWarning[] = [];

  for (const action of actions) {
    const target = action.target ?? '';
    if (/\*\*Action:\*\*|\*\*Assertion:\*\*|Action:|Assertion:/i.test(target)) {
      warnings.push(warning(scenarioId, action, 'high', 'markdown-leak', 'Action target contains Markdown action/assertion text.'));
    }
    if (target.length > 80) {
      warnings.push(warning(scenarioId, action, 'medium', 'long-target', 'Action target looks like a sentence or paragraph.'));
    }
    if (['navigate', 'click', 'select', 'fill'].includes(action.actionType) && !action.target) {
      warnings.push(warning(scenarioId, action, 'high', 'missing-target', `${action.actionType} action has no target.`));
    }
    if (['fill', 'select'].includes(action.actionType) && action.payloadKey && !action.value) {
      warnings.push(warning(scenarioId, action, 'medium', 'missing-value', `${action.actionType} action has a payload key but no value.`));
    }
    if (action.actionType === 'unknown') {
      warnings.push(warning(scenarioId, action, 'low', 'unknown-action', 'Unknown action was extracted and will be skipped by recon.'));
    }
    if (action.actionType !== 'row_action' && looksLikeUnresolvedRecordTarget(action)) {
      warnings.push(
        warning(
          scenarioId,
          action,
          'high',
          'row-action-not-normalized',
          'Action appears to target a business record but was not normalized to row_action.'
        )
      );
    }
  }

  return warnings;
}

function looksLikeUnresolvedRecordTarget(action: ScenarioAtomicAction): boolean {
  const target = action.target ?? '';
  const combined = `${action.sourceStepTitle} ${action.rawActionText} ${target}`;
  if (!/\b(user|customer|record|row|item|license|employee|member|account|entry|profile)\b/i.test(combined)) {
    return false;
  }

  return (
    /\b(?:select|click|choose|open)\s+(?:on\s+)?(?:the\s+)?(?:user|customer|record|row|item|license|employee|member|account|entry|profile)\b/i.test(
      combined
    ) || /\b(user|customer|record|row|item|license|employee|member|account|entry|profile)\s+to\s+(?:edit|delete|deactivate|activate|view|approve|reject)\b/i.test(target)
  );
}

function warning(
  scenarioId: string,
  action: ScenarioAtomicAction,
  severity: ActionExtractionWarning['severity'],
  rule: string,
  message: string
): ActionExtractionWarning {
  return {
    scenario_id: scenarioId,
    stepNo: action.stepNo,
    severity,
    rule,
    message,
    rawActionText: action.rawActionText,
    target: action.target
  };
}

function shouldSkipActionText(sourceStepTitle: string, rawActionText: string): boolean {
  const combined = `${sourceStepTitle} ${rawActionText}`;
  return (
    isLoginSection(sourceStepTitle) ||
    /process\.env\.(?:username|password|login|email)|login page|login button|password input|username input|ensure .*logged in|log out|attempt to log in|credentials/i.test(
      combined
    )
  );
}

function isLoginSection(title: string): boolean {
  return /\b(login|log in|sign in|authenticate|authentication)\b/i.test(title);
}

function cleanMarkdownText(value: string): string {
  return value
    .replace(/^\s*(?:[-*+]\s*)+/, '')
    .replace(/\*\*/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.*?)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '');
}

function cleanTarget(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/^["'`]|["'`]$/g, '')
    .replace(/\bvia\s+the\s+main\s+menu\b/gi, '')
    .replace(/\bfrom\s+the\s+list\b/gi, '')
    .replace(/\b(?:page|screen|button|field|input|dropdown|select element|navigation link|menu item|link)\b/gi, '')
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.:;]+$/g, '');

  if (!cleaned) return null;
  return cleaned
    .split(/\s+/)
    .map((word) => (/^[A-Z0-9]{2,}$/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

function quotedValues(value: string): string[] {
  const matches: string[] = [];
  const pattern = /["'`]([^"'`]+)["'`]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    if (match[1]) {
      matches.push(match[1].trim());
    }
  }
  return matches;
}

function extractedLiteralValue(text: string): string | null {
  return quotedValues(text)[0] ?? null;
}

function isIdentityValue(value: string): boolean {
  return /@|[A-Z]{2,}-?\d+|\d{4,}/i.test(value);
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (secretKeyPattern.test(key) || value === undefined || value === null) {
      continue;
    }

    const stringValue = String(value).trim();
    if (!stringValue || /password|secret|token|jwt|bearer\s+/i.test(stringValue)) {
      continue;
    }

    sanitized[key] = stringValue;
  }

  return sanitized;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalizeNullable(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

if (require.main === module) {
  extractMarkdownActions()
    .then((results) => {
      logger.info(`Extracted actions for ${results.length} scenario file(s).`);
    })
    .catch((error) => {
      logger.error('Markdown action extraction failed.', error);
      process.exitCode = 1;
    });
}
