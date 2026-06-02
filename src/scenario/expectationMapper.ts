import { callLLM } from '../llm/llmClient';
import { logger } from '../utils/logger';
import type { NormalizedStep } from './stepNormalizer';

interface ExpectedMapping {
  expectedResultIndex: number;
  stepIndex: number;
}

/**
 * Segments expected results and maps/binds them to the specific steps where they are verified or triggered.
 */
export async function mapExpectedResultsToSteps(
  steps: NormalizedStep[],
  payload: Record<string, unknown> = {}
): Promise<NormalizedStep[]> {
  const expectedItems = new Set<string>();

  for (const step of steps) {
    if (step.expected_result) {
      // Split by semicolon or newline
      const segments = step.expected_result
        .split(/[;\n]/)
        .map(s => s.replace(/^\s*(?:step\s*)?\d+[\).:-]\s*/i, '').trim())
        .filter(Boolean);
      for (const segment of segments) {
        expectedItems.add(segment);
      }
    }
  }

  if (expectedItems.size === 0) {
    // Clear expected results since there are none
    return steps.map(s => ({ ...s, expected_result: undefined }));
  }

  const expectedArray = Array.from(expectedItems);
  let mappings: ExpectedMapping[] = [];

  try {
    mappings = await mapWithLLM(steps, expectedArray, payload);
  } catch (error) {
    logger.warn('LLM expectation mapping failed; falling back to heuristics.', error);
    mappings = mapWithHeuristics(steps, expectedArray);
  }

  // Group mapped expected results by step index
  const stepExpectations: Record<number, string[]> = {};
  for (const mapping of mappings) {
    const sIdx = mapping.stepIndex;
    const eText = expectedArray[mapping.expectedResultIndex];
    if (sIdx >= 0 && sIdx < steps.length && eText) {
      if (!stepExpectations[sIdx]) {
        stepExpectations[sIdx] = [];
      }
      stepExpectations[sIdx].push(eText);
    }
  }

  // Update steps with their mapped expected results
  return steps.map((step, idx) => {
    const mapped = stepExpectations[idx];
    return {
      ...step,
      expected_result: mapped && mapped.length > 0 ? mapped.join('; ') : undefined
    };
  });
}

async function mapWithLLM(
  steps: NormalizedStep[],
  expectedArray: string[],
  payload: Record<string, unknown>
): Promise<ExpectedMapping[]> {
  const prompt = `You are a test automation mapping assistant. You are given a list of expected result segments and a list of step instructions.
Your job is to match each expected result segment to the step (by index, 0-based) where that expectation first becomes true or is verified.

Steps:
${steps.map((s, idx) => `${idx}: ${s.instruction}`).join('\n')}

Expected Results:
${expectedArray.map((item, idx) => `${idx}: "${item}"`).join('\n')}

Guidelines:
1. Choose the most appropriate step index for each expected result.
2. If a result is an overall test case outcome (e.g. "User is added to list", "User status is updated"), map it to the last step of the test.
3. Respond ONLY with a valid JSON array of objects with the structure:
[
  { "expectedResultIndex": 0, "stepIndex": 1 }
]
Do not include markdown code block formatting (like \`\`\`json) or any explanation. Just the raw JSON.`;

  const responseText = await callLLM(prompt);
  const cleanResponse = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleanResponse);

  if (!Array.isArray(parsed)) {
    throw new Error('LLM did not return a JSON array');
  }

  return parsed as ExpectedMapping[];
}

function mapWithHeuristics(steps: NormalizedStep[], expectedArray: string[]): ExpectedMapping[] {
  return expectedArray.map((item, eIdx) => {
    let bestStepIdx = steps.length - 1; // Default to the last step
    let bestScore = -1;

    const lowerItem = item.toLowerCase();

    for (let sIdx = 0; sIdx < steps.length; sIdx++) {
      const step = steps[sIdx];
      const lowerInstruction = step.instruction.toLowerCase();
      let score = 0;

      // 1. Navigation / page load expected outcomes
      if (lowerItem.includes('page is displayed') || lowerItem.includes('loaded') || lowerItem.includes('redirect')) {
        if (lowerInstruction.includes('navigate') || lowerInstruction.includes('go to') || lowerInstruction.includes('click')) {
          score += 2;
        }
      }

      // 2. Input values
      if (lowerItem.includes('field') || lowerItem.includes('value') || lowerItem.includes('reflects') || lowerItem.includes('entered')) {
        if (lowerInstruction.includes('fill') || lowerInstruction.includes('enter') || lowerInstruction.includes('type') || lowerInstruction.includes('select')) {
          score += 2;
        }
      }

      // 3. Dropdowns
      if (lowerItem.includes('dropdown') || lowerItem.includes('role')) {
        if (lowerInstruction.includes('select') || lowerInstruction.includes('dropdown') || lowerInstruction.includes('role')) {
          score += 3;
        }
      }

      // 4. Save/Submit outcomes
      if (lowerItem.includes('saved') || lowerItem.includes('updated') || lowerItem.includes('success')) {
        if (lowerInstruction.includes('save') || lowerInstruction.includes('submit')) {
          score += 4;
        }
      }

      // Keyword overlaps
      const stepWords = lowerInstruction.split(/\W+/).filter(w => w.length > 3);
      for (const word of stepWords) {
        if (lowerItem.includes(word)) {
          score += 1;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestStepIdx = sIdx;
      }
    }

    return {
      expectedResultIndex: eIdx,
      stepIndex: bestStepIdx
    };
  });
}
