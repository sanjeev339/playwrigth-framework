import { Page } from '@playwright/test';
import { Logger } from '../../core/logger/Logger';
import { IndicatorRepositoryPage } from '../../page_objects/indicator_repository/IndicatorRepositoryPage';

export class IndicatorRepositoryAction {
    private readonly indicatorRepositoryPage: IndicatorRepositoryPage;

    constructor(page: Page) {
        this.indicatorRepositoryPage = new IndicatorRepositoryPage(page);
    }

    async gotoPillars(): Promise<void> {
        Logger.info('Navigating to Pillars');
        await this.indicatorRepositoryPage.gotoPillars();
    }

    async gotoTopics(): Promise<void> {
        Logger.info('Navigating to Topics');
        await this.indicatorRepositoryPage.gotoTopics();
    }

    async gotoDisclosure(): Promise<void> {
        Logger.info('Navigating to Disclosure');
        await this.indicatorRepositoryPage.gotoDisclosure();
    }

    async createPillar(name: string, description: string): Promise<void> {
        Logger.info(`Creating pillar ${name}`);
        await this.indicatorRepositoryPage.openAddPillarForm();
        await this.indicatorRepositoryPage.createPillar(name, description);
    }

    async createTopic(pillarName: string, topicName: string): Promise<void> {
        Logger.info(`Creating topic ${topicName} under pillar ${pillarName}`);
        await this.indicatorRepositoryPage.openAddTopicForm();
        await this.indicatorRepositoryPage.createTopic(pillarName, topicName);
    }

    async createDisclosure(pillarName: string, topicName: string, disclosureName: string): Promise<void> {
        Logger.info(`Creating disclosure ${disclosureName} under topic ${topicName}`);
        await this.indicatorRepositoryPage.openAddDisclosureForm();
        await this.indicatorRepositoryPage.createDisclosure(pillarName, topicName, disclosureName);
    }
}
