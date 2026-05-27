import type { Page } from '@playwright/test';
import type { DomElementSnapshot } from '../types';
import { addLocatorCandidates, isStableIdentifier } from './locatorCandidateBuilder';

export async function scanVisibleDom(page: Page): Promise<DomElementSnapshot[]> {
  const elements = await page.evaluate(() => {
    const selector = [
      'input',
      'textarea',
      'select',
      'button',
      'a',
      '[role]',
      '[contenteditable="true"]',
      'label',
      'option',
      'li',
      'div[role="button"]',
      'div[role="listbox"]',
      'div[role="option"]',
      'span[role="button"]',
      'span[role="option"]'
    ].join(',');

    const baseNodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const pointerNodes = Array.from(document.querySelectorAll<HTMLElement>('div,span')).filter((element) => {
      const style = window.getComputedStyle(element);
      return style.cursor === 'pointer' || element.hasAttribute('onclick') || element.tabIndex >= 0;
    });
    const nodes = Array.from(new Set([...baseNodes, ...pointerNodes]));

    return nodes
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const parentSelect = element.parentElement instanceof HTMLSelectElement ? element.parentElement : null;
        const parentSelectRect = parentSelect?.getBoundingClientRect();
        const parentSelectStyle = parentSelect ? window.getComputedStyle(parentSelect) : null;
        const isParentSelectVisible = Boolean(
          parentSelectRect &&
            parentSelectRect.width > 0 &&
            parentSelectRect.height > 0 &&
            parentSelectStyle?.display !== 'none' &&
            parentSelectStyle?.visibility !== 'hidden' &&
            Number(parentSelectStyle?.opacity ?? 1) !== 0
        );
        const tag = element.tagName.toLowerCase();
        const input = element instanceof HTMLInputElement ? element : null;
        const text = normalizeText(element.innerText || element.textContent || '');
        const type = input?.type || (element instanceof HTMLButtonElement ? element.type : undefined);
        const isPassword = tag === 'input' && type?.toLowerCase() === 'password';
        const value =
          isPassword || !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)
            ? undefined
            : truncate(normalizeText(element.value), 120);

        return {
          index,
          tag,
          type,
          id: element.id || undefined,
          name: element.getAttribute('name') || undefined,
          className: typeof element.className === 'string' ? truncate(element.className, 180) || undefined : undefined,
          text: truncate(text, 180) || undefined,
          role: element.getAttribute('role') || undefined,
          ariaLabel: element.getAttribute('aria-label') || undefined,
          label: getLabelText(element) || undefined,
          placeholder: element.getAttribute('placeholder') || undefined,
          title: element.getAttribute('title') || undefined,
          value,
          dataTestId: element.getAttribute('data-testid') || undefined,
          dataTest: element.getAttribute('data-test') || undefined,
          dataCy: element.getAttribute('data-cy') || undefined,
          dataQa: element.getAttribute('data-qa') || undefined,
          href: element instanceof HTMLAnchorElement ? element.href || undefined : undefined,
          isVisible:
            (rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity) !== 0) ||
            (tag === 'option' && isParentSelectVisible),
          isEnabled: !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true',
          isLikelyClickable: style.cursor === 'pointer' || element.hasAttribute('onclick') || element.tabIndex >= 0,
          boundingBox:
            rect.width > 0 && rect.height > 0
              ? {
                  x: Math.round(rect.x),
                  y: Math.round(rect.y),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height)
                }
              : undefined,
          cssCandidate: buildCssCandidate(element),
          xpathCandidate: buildXPathCandidate(element)
        };
      })
      .filter((element) => element.isVisible);

    function getLabelText(element: HTMLElement): string {
      const labels = (element as HTMLInputElement).labels;
      if (labels?.length) {
        return normalizeText(Array.from(labels).map((label) => label.innerText).join(' '));
      }

      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        return normalizeText(
          labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.innerText || '')
            .join(' ')
        );
      }

      const wrappingLabel = element.closest('label');
      return normalizeText(wrappingLabel?.innerText || '');
    }

    function buildCssCandidate(element: HTMLElement): string {
      const testId = element.getAttribute('data-testid');
      if (testId) return `[data-testid="${cssEscape(testId)}"]`;

      const dataTest = element.getAttribute('data-test');
      if (dataTest) return `[data-test="${cssEscape(dataTest)}"]`;

      const dataCy = element.getAttribute('data-cy');
      if (dataCy) return `[data-cy="${cssEscape(dataCy)}"]`;

      const dataQa = element.getAttribute('data-qa');
      if (dataQa) return `[data-qa="${cssEscape(dataQa)}"]`;

      const name = element.getAttribute('name');
      if (name) return `${element.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;

      const id = element.id;
      if (id && id.length <= 64) return `#${cssEscape(id)}`;

      const ariaLabel = element.getAttribute('aria-label');
      if (ariaLabel) return `${element.tagName.toLowerCase()}[aria-label="${cssEscape(ariaLabel)}"]`;

      return nthOfTypeSelector(element);
    }

    function buildXPathCandidate(element: HTMLElement): string {
      const segments: string[] = [];
      let current: HTMLElement | null = element;

      while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
        const tag = current.tagName.toLowerCase();
        const siblings = Array.from(current.parentElement?.children || []).filter((sibling) => sibling.tagName.toLowerCase() === tag);
        const index = siblings.indexOf(current) + 1;
        segments.unshift(`${tag}[${index}]`);
        current = current.parentElement;
      }

      return `/html/body/${segments.join('/')}`;
    }

    function nthOfTypeSelector(element: HTMLElement): string {
      const segments: string[] = [];
      let current: HTMLElement | null = element;

      while (current && current !== document.body && segments.length < 4) {
        const tag = current.tagName.toLowerCase();
        const siblings = Array.from(current.parentElement?.children || []).filter((sibling) => sibling.tagName.toLowerCase() === tag);
        const index = siblings.indexOf(current) + 1;
        segments.unshift(`${tag}:nth-of-type(${index})`);
        current = current.parentElement;
      }

      return segments.join(' > ');
    }

    function normalizeText(value: string): string {
      return value.replace(/\s+/g, ' ').trim();
    }

    function truncate(value: string, maxLength: number): string {
      return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
    }

    function cssEscape(value: string): string {
      return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }
  });

  const sanitized = elements.map((element) => {
    const shouldUseId = element.id ? isStableIdentifier(element.id) : false;
    return {
      ...element,
      cssCandidate: shouldUseId || !element.cssCandidate?.startsWith('#') ? element.cssCandidate : undefined
    };
  });

  return addLocatorCandidates(sanitized);
}
