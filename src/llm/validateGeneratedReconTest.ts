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
    if (action.actionStatus === 'failed' && !action.dropdownLocator && !action.selectedLocator) {
      continue;
    }

    const payloadKey = action.target;
    if (!payloadKey || !Object.prototype.hasOwnProperty.call(scenario.payload, payloadKey)) {
      continue;
    }

    const payloadValue = String(scenario.payload[payloadKey] ?? '').toLowerCase();
    const normalizedCode = code.toLowerCase();
    const keyLower = payloadKey.toLowerCase();
    const hasPayloadRef =
      normalizedCode.includes(`payload["${keyLower}"]`) ||
      normalizedCode.includes(`payload['${keyLower}']`) ||
      normalizedCode.includes(`payload[\`${keyLower}\`]`) ||
      normalizedCode.includes(`payload.${keyLower}`);
    const hasValue = payloadValue.length > 0 && normalizedCode.includes(payloadValue);
    const isSkipped = normalizedCode.includes('recon-skip');

    if (!hasPayloadRef && !hasValue && !isSkipped) {
      throw new Error(`Generated test missing payload reference for select target: ${payloadKey}`);
    }
  }

  for (const action of reconActions) {
    if (action.actionType === 'fill' && action.target && action.target !== '__FORM__') {
      if (action.actionStatus === 'failed' && !action.selectedLocator) {
        continue;
      }
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
  if (firstAction?.selectedLocator && !containsLocator(code, firstAction.selectedLocator)) {
    throw new Error('Generated test missing post-login locator from first recon action.');
  }

  for (const action of reconActions) {
    if (action.stepNo === undefined) {
      continue;
    }

    if (!containsStepMarker(code, action.stepNo, action.rawStep)) {
      throw new Error(`Generated test missing required recon action: Step ${action.stepNo} - ${action.rawStep}`);
    }

    if (action.actionStatus === 'failed' && !action.selectedLocator) {
      if (!code.includes('recon-skip')) {
        throw new Error(`Generated test missing skip marker for failed recon step ${action.stepNo}`);
      }
      continue;
    }

    if (
      action.actionStatus === 'success' &&
      action.selectedLocator &&
      action.actionType !== 'select' &&
      !containsLocator(code, action.selectedLocator) &&
      !isPayloadStableRowLocator(action, scenario.payload, code)
    ) {
      throw new Error(`Generated test missing required recon locator: Step ${action.stepNo} - ${action.rawStep}`);
    }
  }
}

function isPayloadStableRowLocator(
  action: ReconAction,
  payload: Record<string, unknown>,
  code: string
): boolean {
  const fullName = String(payload['Full Name'] ?? '');
  const email = String(payload['Email Address'] ?? '');

  if (fullName && code.includes(fullName)) {
    return true;
  }

  if (email && code.includes(email)) {
    return true;
  }

  return /getByRole\(['"]row['"]\)\.filter/.test(code);
}

function normalizeLocator(str: string): string {
  return str
    .replace(/['"`]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/\s*([()\[\]{}:,])\s*/g, '$1')
    .trim();
}

function containsLocator(code: string, locator: string): boolean {
  const normalizedCode = normalizeLocator(code);
  const normalizedLocator = normalizeLocator(locator);
  return normalizedCode.includes(normalizedLocator);
}

function normalizeStepText(str: string): string {
  return str
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsStepMarker(code: string, stepNo: number, rawStep: string): boolean {
  const expectedNormalized = `step ${stepNo} ${normalizeStepText(rawStep)}`;
  const codeNormalized = normalizeStepText(code);
  return codeNormalized.includes(expectedNormalized);
}


