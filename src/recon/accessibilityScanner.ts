import type { Page } from '@playwright/test';
import type { AccessibilityNode } from '../types';

export async function scanAccessibility(page: Page): Promise<AccessibilityNode | Record<string, never>> {
  try {
    const context = page.context();
    const client = await context.newCDPSession(page);
    const { nodes } = (await client.send('Accessibility.getFullAXTree')) as {
      nodes: Array<{
        nodeId: string;
        ignored: boolean;
        role?: { value: string };
        name?: { value: string };
        value?: { value: string | number };
        checked?: { value: boolean | 'mixed' };
        selected?: { value: boolean };
        childIds?: string[];
      }>;
    };
    await client.detach();

    if (!nodes || nodes.length === 0) {
      return {};
    }

    const nodeMap = new Map<string, typeof nodes[0]>();
    for (const node of nodes) {
      if (!node.ignored) {
        nodeMap.set(node.nodeId, node);
      }
    }

    const buildTree = (nodeId: string): AccessibilityNode | null => {
      const raw = nodeMap.get(nodeId);
      if (!raw) return null;

      const simplified: AccessibilityNode = {};
      if (raw.role?.value) simplified.role = raw.role.value;
      if (raw.name?.value) simplified.name = raw.name.value;
      if (raw.value?.value !== undefined) simplified.value = raw.value.value;
      if (raw.checked?.value !== undefined) simplified.checked = raw.checked.value;
      if (raw.selected?.value !== undefined) simplified.selected = raw.selected.value;

      if (raw.childIds && raw.childIds.length > 0) {
        const children: AccessibilityNode[] = [];
        for (const childId of raw.childIds) {
          const childNode = buildTree(childId);
          if (childNode && Object.keys(childNode).length > 0) {
            children.push(childNode);
          }
        }
        if (children.length > 0) {
          simplified.children = children;
        }
      }

      return simplified;
    };

    const rootNode = nodes.find(n => n.role?.value === 'WebArea' || n.role?.value === 'RootWebArea') || nodes[0];
    if (rootNode) {
      const tree = buildTree(rootNode.nodeId);
      return tree || {};
    }
    return {};
  } catch (err) {
    // Return empty object on failure to keep recon running smoothly
    return {};
  }
}
