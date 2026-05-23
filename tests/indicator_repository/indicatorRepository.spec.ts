import { expect, test } from '../../fixtures/indicatorRepository.session.fixture';
import { indicatorRepositoryScenarios } from '../../test-data/indicator_repository/indicatorRepository.scenarios';

type ScenarioResult = {
    scenarioId: string;
    scenarioTitle: string;
    outcome: 'passed' | 'failed';
    notes: string;
};

const executionResults: ScenarioResult[] = [];
const runtimeStore: Record<string, string> = {};

function uniqueValue(base: string): string {
    return `${base}_${Date.now()}`;
}

test.describe.serial('Indicator Repository data-driven scenarios', () => {
    test.describe.configure({ timeout: 60_000 });

    test.afterAll(async () => {
        console.table(executionResults);
    });

    for (const scenario of indicatorRepositoryScenarios.sort((a, b) => a.execution_order - b.execution_order)) {
        test(`${scenario.scenario_id} - ${scenario.scenario_title}`, async ({
            indicatorRepositoryAction,
            indicatorRepositoryPage,
        }) => {
            let notes = '';

            try {
                switch (scenario.scenario_id) {
                    case 'TC-PF-001': {
                        const pillarName = uniqueValue(scenario.payload['Pillar Name'].replace(/\s+/g, '_'));
                        runtimeStore.pillarName = pillarName;
                        await indicatorRepositoryAction.gotoPillars();
                        await indicatorRepositoryAction.createPillar(
                            pillarName,
                            scenario.payload['Pillar Description'],
                        );
                        await indicatorRepositoryPage.searchPillar(pillarName);
                        await expect(indicatorRepositoryPage.pillarCardByName(pillarName)).toBeVisible();
                        notes = `Created pillar ${pillarName}.`;
                        break;
                    }
                    case 'TC-TO-002': {
                        const pillarName = runtimeStore.pillarName;
                        const topicName = uniqueValue(scenario.payload['Topic Name'].replace(/\s+/g, '_'));
                        runtimeStore.topicName = topicName;
                        await indicatorRepositoryAction.gotoTopics();
                        await indicatorRepositoryAction.createTopic(pillarName, topicName);
                        await indicatorRepositoryPage.searchTopic(topicName);
                        await expect(indicatorRepositoryPage.topicRowByName(topicName)).toBeVisible();
                        notes = `Created topic ${topicName} under ${pillarName}.`;
                        break;
                    }
                    case 'TC-DM-003': {
                        const pillarName = runtimeStore.pillarName;
                        const topicName = runtimeStore.topicName;
                        await indicatorRepositoryAction.gotoDisclosure();
                        await indicatorRepositoryPage.openAddDisclosureForm();
                        await indicatorRepositoryPage.selectDisclosurePillar(pillarName);
                        const topicFieldExists = await indicatorRepositoryPage.disclosureTopicFieldExists();
                        if (!topicFieldExists) {
                            throw new Error(
                                'Current Disclosure UI does not expose a Topic selector after selecting Pillar.',
                            );
                        }
                        await indicatorRepositoryPage.selectDisclosureTopic(topicName);
                        const codeExists = await indicatorRepositoryPage.disclosureCodeFieldExists();
                        if (!codeExists) {
                            throw new Error(
                                'Current Disclosure UI does not expose a Disclosure Code field even after selecting Pillar and Topic.',
                            );
                        }
                        const disclosureName = uniqueValue(scenario.payload['Disclosure Name'].replace(/\s+/g, '_'));
                        runtimeStore.disclosureName = disclosureName;
                        await indicatorRepositoryPage.createDisclosure(pillarName, topicName, disclosureName);
                        await expect(indicatorRepositoryPage.disclosureRowByName(disclosureName)).toBeVisible();
                        notes = `Created disclosure ${disclosureName}.`;
                        break;
                    }
                    default:
                        throw new Error(`Unhandled scenario ${scenario.scenario_id}`);
                }

                executionResults.push({
                    scenarioId: scenario.scenario_id,
                    scenarioTitle: scenario.scenario_title,
                    outcome: 'passed',
                    notes,
                });
            } catch (error) {
                executionResults.push({
                    scenarioId: scenario.scenario_id,
                    scenarioTitle: scenario.scenario_title,
                    outcome: 'failed',
                    notes: error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
        });
    }
});
