import type { Page } from '@playwright/test';
import type { AccessibilityNode } from '../types';

export async function scanAccessibility(page: Page): Promise<AccessibilityNode | Record<string, never>> {
  const accessibility = (page as unknown as { accessibility?: { snapshot: (options?: unknown) => Promise<unknown> } }).accessibility;

  if (!accessibility?.snapshot) {
    return {};
  }

  const snapshot = await accessibility.snapshot({ interestingOnly: true });
  return simplifyAccessibilityNode(snapshot);
}

function simplifyAccessibilityNode(node: unknown): AccessibilityNode | Record<string, never> {
  if (!node || typeof node !== 'object') {
    return {};
  }

  const raw = node as Record<string, unknown>;
  const simplified: AccessibilityNode = {};

  if (typeof raw.role === 'string') simplified.role = raw.role;
  if (typeof raw.name === 'string') simplified.name = raw.name;
  if (typeof raw.value === 'string' || typeof raw.value === 'number') simplified.value = raw.value;
  if (typeof raw.checked === 'boolean' || raw.checked === 'mixed') simplified.checked = raw.checked;
  if (typeof raw.selected === 'boolean') simplified.selected = raw.selected;

  if (Array.isArray(raw.children)) {
    const children = raw.children.map(simplifyAccessibilityNode).filter((child) => Object.keys(child).length > 0) as AccessibilityNode[];
    if (children.length > 0) {
      simplified.children = children;
    }
  }

  return simplified;
}
