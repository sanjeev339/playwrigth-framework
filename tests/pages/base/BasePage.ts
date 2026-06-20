import type { Locator, Page } from '@playwright/test';
import {
  firstUsable,
  fillFirst,
  clickFirst,
  configuredLocator,
  selectCustomDropdown,
  clickMenuItemAfterRowAction
} from '../../actions';

/**
 * Base class for all Page Objects.
 * Exposes action helpers as protected methods so subclasses
 * can call this.fillFirst(), this.clickFirst(), etc.
 */
export class BasePage {
  constructor(protected readonly page: Page) {}

  protected async firstUsable(locator: Locator): Promise<Locator | null> {
    return firstUsable(locator);
  }

  protected async fillFirst(label: string, locators: Locator[], value: string): Promise<void> {
    return fillFirst(label, locators, value);
  }

  protected async clickFirst(label: string, locators: Locator[]): Promise<void> {
    return clickFirst(label, locators);
  }

  protected configuredLocator(selector: string | undefined): Locator {
    return configuredLocator(this.page, selector);
  }

  protected async selectCustomDropdown(
    openFn: () => Locator,
    optionValue: string
  ): Promise<void> {
    return selectCustomDropdown(this.page, openFn, optionValue);
  }

  protected async clickMenuItemAfterRowAction(
    label: string,
    openMenu: () => Locator,
    item: () => Locator
  ): Promise<void> {
    return clickMenuItemAfterRowAction(label, openMenu, item);
  }
}
