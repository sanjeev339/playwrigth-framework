import path from 'node:path';
import fs from 'fs-extra';
import { writeTextFile, readTextFile } from '../utils/fileUtils';
import { logger } from '../utils/logger';
import { callLLM } from '../llm/llmClient';
import type { ScenarioExecutionReport } from '../runner/dynamicScenarioRunner';
import type { FrontendStepIssue } from '../types';
import { getFrameworkPaths } from '../config/env';

export async function writeReviewerReport(
  reports: ScenarioExecutionReport[],
  frontendIssues: Record<string, FrontendStepIssue[]>,
  runTimestamp: string,
  outputDir: string
): Promise<string> {
  const filePath = path.join(outputDir, `reviewer-report--${runTimestamp}.md`);
  logger.info(`Starting generation of Reviewer Report via LLM...`);

  // Load requirements context if available
  const requirementsPath = getFrameworkPaths().extractedRequirementsPath;
  let requirementsContext = '';
  try {
    if (await fs.pathExists(requirementsPath)) {
      requirementsContext = await readTextFile(requirementsPath);
      logger.info(`Loaded requirements context from: ${requirementsPath} (${requirementsContext.length} chars)`);
    } else {
      logger.warn(`Requirements context file not found at: ${requirementsPath}`);
    }
  } catch (error) {
    logger.warn(`Failed to read requirements context file:`, error);
  }

  // Filter and format scenario details for the LLM
  const scenariosWithIssues = reports.map((report) => {
    const issues = frontendIssues[report.scenarioId] || [];
    return {
      scenarioId: report.scenarioId,
      module: report.module,
      action: report.action,
      status: report.status,
      loginStatus: report.loginStatus,
      loginError: report.loginError,
      failureReason: report.failureReason,
      steps: report.steps.map((s) => ({
        stepNo: s.stepNo,
        instruction: s.instruction,
        expectedResult: s.expectedResult,
        status: s.status,
        failureReason: s.failureReason,
        selectedLocator: s.decision?.selectedLocator,
        actionError: s.decision?.actionError,
        llmReason: s.decision?.llmReason,
      })),
      frontendReviewIssues: issues.map((i) => ({
        stepNo: i.stepNo,
        rawStep: i.rawStep,
        actionType: i.actionType,
        selectedLocator: i.selectedLocator,
        actionError: i.actionError,
        issueCodes: i.issueCodes,
        recommendation: i.recommendation,
      })),
    };
  });

  let prompt = `You are a Senior QA Analyst and Business Alignment Auditor. Your task is to generate a comprehensive "Reviewer Report" that documents all issues, discrepancies, and mismatches identified between the Business Requirements Document (BRD) / Functional Specification Document (FSD) and the actual application under test during our automated dynamic execution run.

`;

  if (requirementsContext) {
    prompt += `### Extracted FSD/BRD Requirements Context:
Below is the official FSD/BRD context containing requirements, rules, and workflows to compare against:
\`\`\`markdown
${requirementsContext}
\`\`\`

`;
  }

  prompt += `### Execution Run Data:
Below is the structured data of the execution run (including all scenarios, step results, locator/action errors, and frontend review issues):

${JSON.stringify(scenariosWithIssues, null, 2)}

### Task Details:
Please audit the above execution data against any provided FSD/BRD context, and output a professional, clear, and comprehensive Markdown report detailing the mismatches, missing details, locator issues, and other alignment problems.

### Report Categories:
Every issue you identify MUST be classified into one of the following 7 categories:
1. **Requirement and Application Mismatch**: The BRD specifies elements, actions, or flows that do not exist or behave differently in the application (e.g. BRD says "select option" but there is no select dropdown, or page layout/steps are different).
2. **Missing or Incorrect Functional Details**: Business rules, field names, navigation paths, or required steps are ambiguous or missing from the BRD.
3. **Locator Extraction Failures**: UI elements in the BRD are not present, application structure differs from requirements, or elements are dynamically generated/inaccessible.
4. **Data and Validation Issues**: Application requires specific data formats, dependencies, or values not specified in the BRD, or validation errors prevent flow progression.
5. **Incomplete User Flows or Unimplemented Features**: BRD steps describe features that are not active or not yet implemented in the app.
6. **Automation Constraints and Tooling Limitations**: Dynamic behaviors, canvas/svg, iframe elements, or framework limitations.
7. **Outdated or Misaligned Steps**: The UI has updated/changed and the BRD steps no longer correspond to the current flow.

### Report Structure:
1. **Title**: A premium-looking title (e.g., "# BRD/FSD & Application Alignment Reviewer Report").
2. **Metadata**: Date generated, total scenarios audited, total failures/blockers.
3. **Executive Summary**: A summary evaluating the quality and alignment of the requirements versus the actual application, pointing out critical blockers.
4. **Discrepancy Summary Table**:
   | Scenario ID | Step No | Expected Behavior (BRD) | Issue Category | Severity (Critical/Major/Minor) |
5. **Detailed Findings by Category**:
   Group the findings by the 7 categories above. For each mismatch or failure found, provide:
   - **Scenario ID & Step Number**
   - **Expected Behavior (BRD/FSD)**
   - **Actual Observation**: (Describe precisely what was observed/failed in the app, referencing errors/locators where relevant)
   - **Severity**:
     - *Critical*: Blocks test generation or test execution (e.g. login failed, element missing, invalid path).
     - *Major*: Dynamic element / fragile selector / missing test ID causing locator risk.
     - *Minor*: Simple testability warning.
   - **Recommended Action**: Clear recommendation to either the Business Analyst (to update the BRD/FSD) or the Developer (to fix/update the UI).
6. **If no issues were found**: If everything passed with zero warnings or errors, generate a clean report stating that the BRD and the application are perfectly aligned and no issues were found.

### Guidelines:
- Do NOT use placeholders. Generate real observations based on the execution data.
- Ensure the output is valid Markdown.
- Use GitHub-style markdown alerts (e.g. \`> [!IMPORTANT]\` or \`> [!WARNING]\`) to make critical recommendations stand out.
- Return ONLY the Markdown content. Do not wrap the entire response in a code block block like \`\`\`markdown or \`\`\`. Start directly with the title.`;

  try {
    let response = await callLLM(prompt, 'reviewer-report');
    
    // Clean up LLM wrapping if it exists
    response = response.trim();
    if (response.startsWith('```markdown')) {
      response = response.slice(11);
    } else if (response.startsWith('```')) {
      response = response.slice(3);
    }
    if (response.endsWith('```')) {
      response = response.slice(0, -3);
    }
    response = response.trim();

    await writeTextFile(filePath, response);
    logger.info(`Successfully wrote Reviewer Report to: ${filePath}`);
    return filePath;
  } catch (error) {
    logger.error('Failed to generate Reviewer Report via LLM:', error);
    // Fallback simple report in case of LLM failure
    const fallbackContent = generateFallbackReport(scenariosWithIssues);
    await writeTextFile(filePath, fallbackContent);
    return filePath;
  }
}

function generateFallbackReport(scenarios: any[]): string {
  let content = `# BRD/FSD & Application Alignment Reviewer Report (Fallback)\n\n`;
  content += `Generated at: **${new Date().toLocaleString()}**\n\n`;
  content += `> [!WARNING]\n`;
  content += `> LLM generation failed. This is a automatically generated fallback report summarizing the run results.\n\n`;
  content += `## Summary Table\n\n`;
  content += `| Scenario | Status | Failed Step | Error |\n`;
  content += `| :--- | :--- | :--- | :--- |\n`;

  for (const s of scenarios) {
    if (s.status === 'failed') {
      const failedStep = s.steps.find((st: any) => st.status === 'failed');
      const err = failedStep?.failureReason || s.failureReason || 'Unknown error';
      content += `| **${s.scenarioId}** | ❌ Failed | Step ${failedStep?.stepNo || 'N/A'} | ${err} |\n`;
    } else {
      content += `| **${s.scenarioId}** | ✅ Passed | - | - |\n`;
    }
  }
  return content;
}
