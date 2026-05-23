import { expect, Locator, Page } from '@playwright/test';
import { BasePage } from '../../core/base/BasePage';
import { ConfigManager } from '../../core/config/ConfigManager';

export class IndicatorRepositoryPage extends BasePage {
    readonly pillarListHeading: Locator;
    readonly newPillarButton: Locator;
    readonly pillarSearchInput: Locator;
    readonly pillarNameInput: Locator;
    readonly pillarDescriptionInput: Locator;
    readonly topicSearchInput: Locator;
    readonly addNewTopicButton: Locator;
    readonly choosePillarsButton: Locator;
    readonly topicNameInput: Locator;
    readonly addNewDisclosureButton: Locator;
    readonly disclosurePillarButton: Locator;
    readonly disclosureTopicButton: Locator;
    readonly disclosureNameInput: Locator;
    readonly saveButton: Locator;

    constructor(page: Page) {
        super(page);
        this.pillarListHeading = page.getByRole('heading', { name: 'Catalog and manage Indicator Repository items' });
        this.newPillarButton = page.getByRole('button', { name: /New Pillar/i });
        this.pillarSearchInput = page.getByRole('searchbox', { name: 'Search by Pillar Name' });
        this.pillarNameInput = page.getByRole('textbox', { name: 'Pillar Name *' });
        this.pillarDescriptionInput = page.getByRole('textbox', { name: 'Type...' });
        this.topicSearchInput = page.getByRole('searchbox', { name: 'Search by Topic Name' });
        this.addNewTopicButton = page.getByRole('button', { name: /Add New Topic/i });
        this.choosePillarsButton = page.getByRole('button', { name: 'Choose Pillars' });
        this.topicNameInput = page.getByRole('textbox', { name: 'Topic Name *' });
        this.addNewDisclosureButton = page.getByRole('button', { name: /Add New Disclosure/i });
        this.disclosurePillarButton = page.getByRole('button', { name: 'Pillar Name' });
        this.disclosureTopicButton = page.getByRole('button', { name: 'Topic Name' });
        this.disclosureNameInput = page.getByRole('textbox', { name: 'Disclosure Name *' });
        this.saveButton = page.getByRole('button', { name: 'Save' });
    }

    private get baseOrigin(): string {
        return new URL(ConfigManager.BASE_URL!).origin;
    }

    private async openRouteAndWaitForAction(url: string, heading: Locator, action: Locator): Promise<void> {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            await this.page.goto(url, { waitUntil: 'domcontentloaded' });
            await expect(heading).toBeVisible({ timeout: 10000 });
            await this.page.waitForLoadState('networkidle').catch(() => undefined);

            if (await action.isVisible().catch(() => false)) {
                return;
            }

            if (attempt < 3) {
                await this.page.waitForTimeout(1500);
            }
        }

        await expect(action).toBeVisible({ timeout: 10000 });
    }

    async gotoPillars(): Promise<void> {
        await this.openRouteAndWaitForAction(
            `${this.baseOrigin}/esg/pillars`,
            this.page.getByRole('heading', { name: 'Indicator Repository', exact: true }),
            this.newPillarButton,
        );
    }

    async gotoTopics(): Promise<void> {
        await this.openRouteAndWaitForAction(
            `${this.baseOrigin}/esg/topics`,
            this.page.getByRole('heading', { name: 'Topics' }),
            this.addNewTopicButton,
        );
    }

    async gotoDisclosure(): Promise<void> {
        await this.openRouteAndWaitForAction(
            `${this.baseOrigin}/esg/disclosure`,
            this.page.getByRole('heading', { name: 'Disclosure' }),
            this.addNewDisclosureButton,
        );
    }

    async openAddPillarForm(): Promise<void> {
        await this.newPillarButton.click();
        await expect(this.page.getByRole('heading', { name: 'Add New Pillar' })).toBeVisible();
    }

    async createPillar(name: string, description: string): Promise<void> {
        await this.pillarNameInput.fill(name);
        await this.pillarDescriptionInput.fill(description);
        await this.saveButton.click();
    }

    pillarCardByName(name: string): Locator {
        return this.page.getByRole('button', { name: new RegExp(`View ${this.escapeRegex(name)} pillar details`, 'i') }).first();
    }

    async searchPillar(name: string): Promise<void> {
        await this.pillarSearchInput.fill(name);
        await this.page.waitForTimeout(1000);
    }

    async openAddTopicForm(): Promise<void> {
        await this.addNewTopicButton.click();
        await expect(this.page.getByRole('heading', { name: 'Create New Topic' })).toBeVisible();
    }

    async selectDropdownOption(trigger: Locator, optionText: string): Promise<void> {
        await trigger.click();
        const search = this.page.getByRole('textbox', { name: 'Search...' });
        if (await search.isVisible().catch(() => false)) {
            await search.fill(optionText);
        }
        await this.page.getByRole('option').filter({ hasText: optionText }).first().click();
    }

    async createTopic(pillarName: string, topicName: string): Promise<void> {
        await this.selectDropdownOption(this.choosePillarsButton, pillarName);
        await this.topicNameInput.fill(topicName);
        await this.saveButton.click();
    }

    topicRowByName(name: string): Locator {
        return this.page.getByRole('row').filter({ hasText: name }).first();
    }

    async searchTopic(name: string): Promise<void> {
        await this.topicSearchInput.fill(name);
        await this.page.waitForTimeout(1000);
    }

    async openAddDisclosureForm(): Promise<void> {
        await this.addNewDisclosureButton.click();
        await expect(this.page.getByRole('heading', { name: 'Create New Disclosure' })).toBeVisible();
    }

    async disclosureCodeFieldExists(): Promise<boolean> {
        const codeField = this.page.getByRole('textbox', { name: /Disclosure Code/i });
        return codeField.isVisible().catch(() => false);
    }

    async disclosureTopicFieldExists(): Promise<boolean> {
        return this.disclosureTopicButton.isVisible().catch(() => false);
    }

    async selectDisclosurePillar(pillarName: string): Promise<void> {
        await this.selectDropdownOption(this.disclosurePillarButton, pillarName);
    }

    async selectDisclosureTopic(topicName: string): Promise<void> {
        await this.selectDropdownOption(this.disclosureTopicButton, topicName);
    }

    async createDisclosure(pillarName: string, topicName: string, disclosureName: string): Promise<void> {
        await this.selectDisclosurePillar(pillarName);
        await this.selectDisclosureTopic(topicName);
        await this.disclosureNameInput.fill(disclosureName);
        await this.saveButton.click();
    }

    disclosureRowByName(name: string): Locator {
        return this.page.getByRole('row').filter({ hasText: name }).first();
    }

    private escapeRegex(value: string): string {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
