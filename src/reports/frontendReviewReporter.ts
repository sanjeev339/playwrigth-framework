import type { DomElementSnapshot, FrontendStepIssue, FrontendIssueCode, ScenarioStep } from '../types';
import type { ReconDecision, ParsedAction } from '../recon/reconDecisionTypes';
import path from 'node:path';
import { writeTextFile } from '../utils/fileUtils';
import { logger } from '../utils/logger';

/**
 * Called once per step inside the actionDecisionEngine.
 * Uses parsedAction, decision, and snapshotElements to detect frontend review issues.
 */
export function collectStepIssues(
  scenarioId: string,
  step: ScenarioStep,
  parsedAction: ParsedAction,
  decision: ReconDecision,
  snapshotElements: DomElementSnapshot[]
): FrontendStepIssue[] {
  const issueCodes: FrontendIssueCode[] = [];

  // Count visible elements in DOM
  const visibleElements = snapshotElements.filter(e => e.isVisible);
  
  // 1. ELEMENT_NOT_IN_DOM
  // Action failed and snapshotElements contains 0 visible elements
  if (decision.actionStatus === 'failed' && visibleElements.length === 0) {
    issueCodes.push('ELEMENT_NOT_IN_DOM');
  }

  // 2. NO_CANDIDATES
  // deterministicCandidates.length === 0 — no locator found at all
  const isInteractiveAction = ['click', 'fill', 'select', 'row_action'].includes(parsedAction.actionType);
  if (isInteractiveAction && decision.deterministicCandidates.length === 0) {
    issueCodes.push('NO_CANDIDATES');
  }

  // 3. ALL_UNSAFE
  // Candidates found but all failed validatedCandidates safety check
  if (
    decision.deterministicCandidates.length > 0 &&
    decision.validatedCandidates.length > 0 &&
    !decision.validatedCandidates.some(v => v.isSafe)
  ) {
    issueCodes.push('ALL_UNSAFE');
  }

  // Find the target element in the DOM snapshot
  const targetElement = findTargetElement(decision, snapshotElements);

  if (targetElement) {
    // 4. NO_TESTID
    // Element matched but has no data-testid, data-cy, data-qa, or data-test
    const hasTestId = !!(
      targetElement.dataTestId ||
      targetElement.dataTest ||
      targetElement.dataCy ||
      targetElement.dataQa
    );
    if (isInteractiveAction && !hasTestId) {
      issueCodes.push('NO_TESTID');
    }

    // 5. DIV_CLICKABLE_NO_ROLE
    // Element is a <div> or <span> acting as a button but has no role attribute
    const tagLower = targetElement.tag.toLowerCase();
    if (
      (tagLower === 'div' || tagLower === 'span') &&
      (parsedAction.actionType === 'click' || targetElement.isLikelyClickable) &&
      !targetElement.role
    ) {
      issueCodes.push('DIV_CLICKABLE_NO_ROLE');
    }

    // 6. NO_ARIA_LABEL
    // Element has no aria-label, no label, and no placeholder — invisible to a11y-based locators
    const isInteractiveTag = ['input', 'button', 'select', 'textarea', 'a'].includes(tagLower) ||
      targetElement.role === 'button' ||
      targetElement.role === 'link' ||
      targetElement.role === 'combobox' ||
      targetElement.role === 'textbox';
      
    if (
      isInteractiveTag &&
      !targetElement.ariaLabel &&
      !targetElement.label &&
      !targetElement.placeholder &&
      !targetElement.title &&
      !targetElement.text
    ) {
      issueCodes.push('NO_ARIA_LABEL');
    }

    // 7. CANVAS_OR_SVG_ELEMENT
    // Element tag is canvas or svg — cannot inspect internals
    if (tagLower === 'canvas' || tagLower === 'svg') {
      issueCodes.push('CANVAS_OR_SVG_ELEMENT');
    }
  } else {
    // Fallback locator string checks if target element is not found directly
    const sel = decision.selectedLocator;
    if (sel) {
      if (isInteractiveAction && !sel.includes('getByTestId') && !sel.includes('[data-testid') && !sel.includes('[data-cy') && !sel.includes('[data-qa') && !sel.includes('[data-test')) {
        issueCodes.push('NO_TESTID');
      }
      if (sel.includes('canvas') || sel.includes('svg')) {
        issueCodes.push('CANVAS_OR_SVG_ELEMENT');
      }
    }
  }

  // 8. DYNAMIC_CLASS_ONLY
  // Best locator found is CSS with a dynamically-looking class (e.g. matches /[a-z]{2,4}[0-9]{3,}/)
  const selLocator = decision.selectedLocator;
  if (selLocator) {
    const isCss = selLocator.startsWith('css=') || (!selLocator.startsWith('xpath=') && !selLocator.includes('getBy'));
    if (isCss) {
      const dynamicClassRegex = /\.[a-z]{2,4}[0-9]{3,}/i;
      const cssModulesRegex = /\._[0-9a-zA-Z]{5,}/;
      if (dynamicClassRegex.test(selLocator) || cssModulesRegex.test(selLocator)) {
        issueCodes.push('DYNAMIC_CLASS_ONLY');
      }
    }
  }

  // 9. HIGH_RISK_LOCATOR
  // Best selected locator has selectorRisk === 'high'
  if (decision.selectorRisk === 'high') {
    issueCodes.push('HIGH_RISK_LOCATOR');
  }

  // 10. XPATH_FALLBACK
  // Selected locator type is xpath (positional, fragile)
  if (selLocator) {
    const isXpath = selLocator.startsWith('xpath=') || selLocator.startsWith('//') || selLocator.startsWith('/');
    if (isXpath) {
      issueCodes.push('XPATH_FALLBACK');
    }
  }

  // Return empty if no issues and the action succeeded
  if (issueCodes.length === 0 && decision.actionStatus !== 'failed') {
    return [];
  }

  const uniqueIssueCodes = Array.from(new Set(issueCodes));

  // Determine element summary details
  let elementSummary: Record<string, unknown> | undefined = undefined;
  if (targetElement) {
    elementSummary = {
      index: targetElement.index,
      tag: targetElement.tag,
      type: targetElement.type,
      role: targetElement.role,
      text: targetElement.text,
      label: targetElement.label,
      ariaLabel: targetElement.ariaLabel,
      placeholder: targetElement.placeholder,
      name: targetElement.name,
      id: targetElement.id,
      testId: targetElement.dataTestId || targetElement.dataTest || targetElement.dataCy || targetElement.dataQa,
      isLikelyClickable: targetElement.isLikelyClickable
    };
  } else if (decision.deterministicCandidates.length > 0) {
    elementSummary = decision.deterministicCandidates[0].elementSummary;
  }

  const recommendation = generateRecommendations(uniqueIssueCodes, targetElement, parsedAction);

  const stepIssue: FrontendStepIssue = {
    stepNo: decision.stepNo ?? step.step_no,
    rawStep: decision.rawStep || step.instruction,
    actionType: parsedAction.actionType,
    decisionSource: decision.decisionSource,
    candidatesFound: decision.deterministicCandidates.length,
    safeCandidatesFound: decision.validatedCandidates.filter(c => c.isSafe).length,
    selectedLocator: decision.selectedLocator,
    selectorRisk: decision.selectorRisk,
    selectorConfidenceSignals: decision.selectorConfidenceSignals,
    llmReason: decision.llmReason,
    actionError: decision.actionError,
    issueCodes: uniqueIssueCodes,
    elementSummary,
    recommendation
  };

  return [stepIssue];
}

/**
 * Searches for the matched element in the DOM snapshot using selected locator patterns.
 */
function findTargetElement(
  decision: ReconDecision,
  snapshotElements: DomElementSnapshot[]
): DomElementSnapshot | null {
  const selected = decision.selectedLocator;
  if (!selected) return null;

  // 1. Try matching with deterministicCandidates element summaries
  const candidate = decision.deterministicCandidates.find(c => c.locator === selected);
  if (candidate && candidate.elementSummary) {
    const idx = candidate.elementSummary.index;
    if (typeof idx === 'number') {
      const el = snapshotElements.find(e => e.index === idx);
      if (el) return el;
    }
  }

  // 2. Match exact cssCandidate or xpathCandidate
  const matchByCssOrXpath = snapshotElements.find(
    e => e.cssCandidate === selected || e.xpathCandidate === selected
  );
  if (matchByCssOrXpath) return matchByCssOrXpath;

  // 3. Match using selector syntax heuristics
  if (selected.startsWith('getByTestId(')) {
    const match = selected.match(/getByTestId\(['"](.+?)['"]\)/);
    if (match) {
      const testId = match[1];
      const el = snapshotElements.find(e => 
        e.dataTestId === testId || e.dataTest === testId || e.dataCy === testId || e.dataQa === testId
      );
      if (el) return el;
    }
  }

  if (selected.startsWith('getByRole(')) {
    const matchRole = selected.match(/getByRole\(['"](.+?)['"]/);
    if (matchRole) {
      const role = matchRole[1];
      const matchName = selected.match(/name:\s*['"](.+?)['"]/);
      if (matchName) {
        const name = matchName[1].toLowerCase();
        const el = snapshotElements.find(e => 
          e.role === role && 
          ((e.text && e.text.toLowerCase().includes(name)) || 
           (e.name && e.name.toLowerCase().includes(name)) || 
           (e.ariaLabel && e.ariaLabel.toLowerCase().includes(name)) ||
           (e.label && e.label.toLowerCase().includes(name)))
        );
        if (el) return el;
      } else {
        const el = snapshotElements.find(e => e.role === role);
        if (el) return el;
      }
    }
  }

  if (selected.startsWith('getByText(')) {
    const match = selected.match(/getByText\(['"](.+?)['"]\)/);
    if (match) {
      const text = match[1].toLowerCase();
      const el = snapshotElements.find(e => e.text && e.text.toLowerCase().includes(text));
      if (el) return el;
    }
  }

  if (selected.startsWith('getByLabel(')) {
    const match = selected.match(/getByLabel\(['"](.+?)['"]\)/);
    if (match) {
      const label = match[1].toLowerCase();
      const el = snapshotElements.find(e => 
        (e.label && e.label.toLowerCase().includes(label)) || 
        (e.ariaLabel && e.ariaLabel.toLowerCase().includes(label))
      );
      if (el) return el;
    }
  }

  if (selected.startsWith('getByPlaceholder(')) {
    const match = selected.match(/getByPlaceholder\(['"](.+?)['"]\)/);
    if (match) {
      const ph = match[1].toLowerCase();
      const el = snapshotElements.find(e => e.placeholder && e.placeholder.toLowerCase().includes(ph));
      if (el) return el;
    }
  }

  // 4. Default to first deterministic candidate's element if all else fails
  if (decision.deterministicCandidates.length > 0) {
    const firstCandidate = decision.deterministicCandidates[0];
    if (firstCandidate.elementSummary) {
      const idx = firstCandidate.elementSummary.index;
      if (typeof idx === 'number') {
        const el = snapshotElements.find(e => e.index === idx);
        if (el) return el;
      }
    }
  }

  return null;
}

/**
 * Builds actionable recommendations for the developers.
 */
function generateRecommendations(
  issueCodes: FrontendIssueCode[],
  targetElement: DomElementSnapshot | null,
  parsedAction: ParsedAction
): string {
  const recommendations: string[] = [];

  for (const code of issueCodes) {
    switch (code) {
      case 'ELEMENT_NOT_IN_DOM':
        recommendations.push(
          'Ensure the target element is loaded, visible, and not covered by overlay/spinners before action. Consider adding loading states or ensuring proper React/Vue hydration.'
        );
        break;
      case 'CANVAS_OR_SVG_ELEMENT':
        recommendations.push(
          'Playwright cannot inspect inside <canvas> or <svg> tags. Wrap the element in a container with a unique identifier (like data-testid) or add a sibling text label for accessible targeting.'
        );
        break;
      case 'NO_CANDIDATES':
        recommendations.push(
          'No locator candidates found. Add unique test identifiers, structured labels, or set proper semantic attributes on the target element.'
        );
        break;
      case 'ALL_UNSAFE':
        recommendations.push(
          'All identified locator candidates were unsafe/non-unique (matched multiple items). Add a unique identifier (e.g. data-testid) to uniquely locate this exact element on the page.'
        );
        break;
      case 'NO_TESTID': {
        const tag = targetElement ? `<${targetElement.tag}>` : 'element';
        recommendations.push(
          `Add a unique test identifier to the ${tag} element, e.g., \`data-testid="todo-item-click"\` or similar, to avoid fragile DOM path locators.`
        );
        break;
      }
      case 'DYNAMIC_CLASS_ONLY':
        recommendations.push(
          'The resolved CSS selector uses auto-generated or dynamic classes (e.g., hash classes from css-in-js/Tailwind/CSS modules). Set a static class name, add a data-testid, or use native text/labels.'
        );
        break;
      case 'DIV_CLICKABLE_NO_ROLE':
        recommendations.push(
          'A non-semantic <div> or <span> tag is acting as a clickable element. Replace it with a native `<button>` or `<a>` tag, or add `role="button"` and `tabindex="0"` to make it accessible.'
        );
        break;
      case 'XPATH_FALLBACK':
        recommendations.push(
          'The locator fallback uses a highly fragile XPath (e.g., positional index like `/div[2]/span[1]`). Simplify the DOM structure or add a stable `data-testid`.'
        );
        break;
      case 'NO_ARIA_LABEL':
        recommendations.push(
          'The element has no text content, placeholder, or aria-label, which makes it invisible to assistive technologies and standard Playwright role/label queries. Add `aria-label`, a text label, or `placeholder`.'
        );
        break;
      case 'HIGH_RISK_LOCATOR':
        recommendations.push(
          'The selected locator uses nested indices or generic CSS paths. Add a clear, semantic identifier to prevent tests from breaking when layout changes.'
        );
        break;
    }
  }

  if (recommendations.length === 0) {
    return 'No specific recommendation. Ensure standard semantic markup and unique test identifiers.';
  }

  if (recommendations.length === 1) {
    return recommendations[0];
  }

  return recommendations.map(r => `- ${r}`).join('\n');
}

/**
 * Called once after all scenarios are completed to write the combined frontend reviews file.
 */
export async function writeCombinedFrontendReport(
  scenarioIssues: Record<string, FrontendStepIssue[]>,
  runTimestamp: string,
  outputDir: string
): Promise<string> {
  const filePath = path.join(outputDir, `frontend-review-report--${runTimestamp}.md`);

  let content = `# Frontend Testability Review Report\n\n`;
  content += `Generated at: **${new Date().toLocaleString()}**\n\n`;
  content += `This report outlines frontend layout mistakes and issues that prevent robust locator extraction during Playwright test generation. Please review the recommendations below to improve application testability.\n\n`;

  // 1. Render Summary Table
  content += `## Summary Table\n\n`;
  content += `| Scenario | Steps with Issues | Issue Codes |\n`;
  content += `| :--- | :--- | :--- |\n`;

  let totalScenarios = 0;
  let totalStepsWithIssues = 0;

  for (const [scenarioId, issues] of Object.entries(scenarioIssues)) {
    if (issues.length === 0) continue;
    totalScenarios++;
    totalStepsWithIssues += issues.length;

    const issueCodesSet = new Set<string>();
    issues.forEach(i => i.issueCodes.forEach(code => issueCodesSet.add(code)));
    const codesStr = issueCodesSet.size > 0 ? Array.from(issueCodesSet).map(c => `\`${c}\``).join(', ') : '—';
    
    content += `| **${scenarioId}** | ${issues.length} | ${codesStr} |\n`;
  }
  content += `\n`;

  if (totalScenarios === 0) {
    content += `*No testability issues or failures detected in this run. All scenarios ran cleanly!*\n`;
  }

  // 2. Render details for each scenario
  for (const [scenarioId, issues] of Object.entries(scenarioIssues)) {
    if (issues.length === 0) continue;

    content += `## Scenario: ${scenarioId}\n\n`;

    for (const issue of issues) {
      const isFailure = issue.actionError ||
        issue.issueCodes.includes('ELEMENT_NOT_IN_DOM') ||
        issue.issueCodes.includes('NO_CANDIDATES') ||
        issue.issueCodes.includes('ALL_UNSAFE');
        
      const icon = isFailure ? '❌' : '⚠️';
      const stepNoStr = issue.stepNo !== undefined ? `Step ${issue.stepNo}` : 'Step';

      content += `### ${icon} ${stepNoStr} — ${issue.rawStep}\n\n`;
      content += `- **Action Type:** \`${issue.actionType}\`\n`;
      
      const sourceDetail = issue.decisionSource === 'deterministic' 
        ? 'deterministic locator candidate' 
        : issue.decisionSource === 'llm' 
          ? 'LLM fallback decision' 
          : 'none (failed to select)';
          
      content += `- **Decision Source:** ${issue.decisionSource} (${sourceDetail})\n`;
      content += `- **Candidates Found:** ${issue.candidatesFound} total, ${issue.safeCandidatesFound} safe\n`;
      content += `- **Selected Locator:** ${issue.selectedLocator ? `\`${issue.selectedLocator}\`` : '*none*'}\n`;
      
      if (issue.selectorRisk) {
        const riskIcon = issue.selectorRisk === 'high' ? '🔴 high' : issue.selectorRisk === 'medium' ? '🟡 medium' : '🟢 low';
        content += `- **Risk:** ${riskIcon}\n`;
      }
      
      if (issue.selectorConfidenceSignals && issue.selectorConfidenceSignals.length > 0) {
        content += `- **Confidence Signals:** ${issue.selectorConfidenceSignals.join(', ')}\n`;
      }
      
      if (issue.llmReason) {
        content += `- **LLM Reason:** "${issue.llmReason.replace(/"/g, '\\"')}"\n`;
      }
      
      if (issue.actionError) {
        content += `- **Error:** \`${issue.actionError}\`\n`;
      }
      
      const codesFormatted = issue.issueCodes.map(c => `\`${c}\``).join(', ');
      content += `- **Issue Codes:** ${codesFormatted}\n`;
      
      if (issue.elementSummary) {
        content += `- **Target Element Details:**\n`;
        const es = issue.elementSummary;
        if (es.tag) content += `  - Tag: \`<${es.tag}>\`\n`;
        if (es.role) content += `  - ARIA Role: \`${es.role}\`\n`;
        if (es.text) content += `  - Visible Text: "${es.text}"\n`;
        if (es.testId) content += `  - Test ID: \`${es.testId}\`\n`;
        else if (es.id) content += `  - ID: \`#${es.id}\`\n`;
        else if (es.name) content += `  - Name attribute: \`${es.name}\`\n`;
      }

      content += `\n**Fix Recommendation:**\n`;
      if (issue.recommendation.startsWith('-')) {
        content += `${issue.recommendation}\n`;
      } else {
        content += `- ${issue.recommendation}\n`;
      }
      content += `\n---\n\n`;
    }
  }

  await writeTextFile(filePath, content);
  logger.info(`Wrote frontend reviews report to -> ${filePath}`);
  return filePath;
}
