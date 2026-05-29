import type { ReconAction } from '../recon/reconActionExtractor';
import { isKnownDropdownField } from '../recon/actionSemantics';
import type { Scenario } from '../types';

export function validateGeneratedReconTest(code: string, scenario: Scenario, reconActions: ReconAction[]): void {
  if (/selectOption\s*\(/.test(code)) {
    throw new Error('Generated test must not use selectOption for custom dropdown widgets.');
  }

  if (code.includes('${baseURL}/login/') || code.includes('/login/login')) {
    throw new Error('Generated test must not append /login/ manually or create /login/login URLs.');
  }

  if (/selectCustomDropdown\([\s\S]*?,\s*""\s*\)/.test(code)) {
    throw new Error('Generated test must not call selectCustomDropdown with an empty option value.');
  }

  const dropdownSelectActions = reconActions.filter(
    (action) => action.actionType === 'select' && isKnownDropdownField(action.target, scenario.payload)
  );

  for (const action of dropdownSelectActions) {
    const payloadKey = action.target;
    if (!payloadKey || !Object.prototype.hasOwnProperty.call(scenario.payload, payloadKey)) {
      continue;
    }

    const payloadRef = `payload[${JSON.stringify(payloadKey)}]`;
    const payloadValue = String(scenario.payload[payloadKey] ?? '').toLowerCase();
    const normalizedCode = code.toLowerCase();
    const hasPayloadRef = normalizedCode.includes(payloadRef.toLowerCase());
    const hasValue = payloadValue.length > 0 && normalizedCode.includes(payloadValue);

    if (!hasPayloadRef && !hasValue) {
      throw new Error(`Generated test missing payload reference for select target: ${payloadKey}`);
    }
  }

  for (const action of reconActions) {
    if (action.actionType === 'fill' && action.target && action.target !== '__FORM__') {
      const payloadKey = action.target;
      if (Object.prototype.hasOwnProperty.call(scenario.payload, payloadKey)) {
        const fragment = String(scenario.payload[payloadKey]).toLowerCase();
        if (fragment && !code.toLowerCase().includes(fragment)) {
          throw new Error(`Generated test missing required field value for ${payloadKey}`);
        }
      }
    }
  }

  const firstAction = reconActions.find((action) => action.stepNo === 1) ?? reconActions[0];
  if (firstAction?.selectedLocator && !code.includes(firstAction.selectedLocator)) {
    throw new Error('Generated test missing post-login locator from first recon action.');
  }

  for (const action of reconActions) {
    if (action.stepNo === undefined) {
      continue;
    }

    const stepMarker = `Step ${action.stepNo}: ${action.rawStep}`;
    if (!code.includes(stepMarker)) {
      throw new Error(`Generated test missing required recon action: Step ${action.stepNo} - ${action.rawStep}`);
    }

    if (
      action.actionStatus === 'success' &&
      action.selectedLocator &&
      action.actionType !== 'select' &&
      !code.includes(action.selectedLocator)
    ) {
      throw new Error(`Generated test missing required recon locator: Step ${action.stepNo} - ${action.rawStep}`);
    }
  }
}
