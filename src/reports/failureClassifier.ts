import { getScenarioRunHistory } from './runHistory';

export interface FailureClassification {
  category: 'infrastructure_flakiness' | 'functional_regression';
  reason: string;
  isFlaky: boolean;
}

export async function classifyFailure(
  scenarioId: string,
  errorMsg: string
): Promise<FailureClassification> {
  const history = await getScenarioRunHistory(scenarioId);
  const recentRuns = history.slice(-5);

  const lowerMsg = errorMsg.toLowerCase();
  let category: 'infrastructure_flakiness' | 'functional_regression' = 'functional_regression';
  let reason = 'Assertion failure or unexpected state';

  if (
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('timed out') ||
    lowerMsg.includes('waiting for selector') ||
    lowerMsg.includes('waiting for locator') ||
    lowerMsg.includes('network') ||
    lowerMsg.includes('navigating') ||
    lowerMsg.includes('detached') ||
    lowerMsg.includes('interactive')
  ) {
    category = 'infrastructure_flakiness';
    reason = 'Timeout or network latency / element non-interactive';
  } else if (lowerMsg.includes('expect(') || lowerMsg.includes('assert') || lowerMsg.includes('equal')) {
    category = 'functional_regression';
    reason = 'Assertion expectation failed';
  } else if (lowerMsg.includes('no element found') || lowerMsg.includes('locator not found')) {
    category = 'functional_regression';
    reason = 'DOM element structure change';
  }

  // Intermittent failures: if it passed recently but now fails on infra reasons, it is flaky
  const previousPassed = recentRuns.some(run => run.status === 'passed');
  const isFlaky = previousPassed && category === 'infrastructure_flakiness';

  return {
    category,
    reason,
    isFlaky
  };
}
