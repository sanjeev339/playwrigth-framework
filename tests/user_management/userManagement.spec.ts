import { expect, test } from '../../fixtures/test.fixture';
import { userManagementScenarios } from '../../test-data/user_management/userManagement.scenarios';

type ScenarioResult = {
    scenarioId: string;
    scenarioTitle: string;
    outcome: 'passed' | 'failed';
    notes: string;
};

test.describe('User Management data-driven scenarios', () => {
    const executionResults: ScenarioResult[] = [];

    test.beforeEach(async ({ loginAction, userManagementAction }) => {
        await loginAction.loginAndWaitForLoad();
        await userManagementAction.navigateToUserManagement();
    });

    test.afterAll(async () => {
        console.table(executionResults);
    });

    for (const scenario of userManagementScenarios.sort((a, b) => a.execution_order - b.execution_order)) {
        test(`${scenario.scenario_id} - ${scenario.scenario_title}`, async ({
            page,
            userManagementAction,
            userManagementPage,
        }) => {
            const payload = scenario.payload;
            let notes = '';

            try {
                switch (scenario.scenario_id) {
                    case 'TC-UM-001': {
                        await userManagementAction.createInternalUser({
                            firstName: payload['First Name'],
                            lastName: payload['Last Name'],
                            email: payload['Email Address'],
                            role: payload.Role,
                        });
                        await userManagementAction.searchUserByEmail(payload['Email Address']);
                        await expect(userManagementPage.userRowByEmail(payload['Email Address'])).toBeVisible();
                        notes = 'User row became visible after create flow.';
                        break;
                    }
                    case 'TC-UM-002': {
                        await userManagementAction.searchUserByEmail(payload['Email Address']);
                        const baselineCount = await userManagementPage.getUserRowCountByEmail(payload['Email Address']);
                        await userManagementPage.searchInput.clear();
                        await userManagementAction.createInternalUser({
                            firstName: payload['First Name'],
                            lastName: payload['Last Name'],
                            email: payload['Email Address'],
                        });
                        const feedback = await userManagementAction.getFeedbackMessage();
                        if (feedback.toLowerCase().includes((payload['Expected Error'] ?? '').toLowerCase())) {
                            notes = `Validation message observed: ${feedback}`;
                        } else {
                            await userManagementAction.closeDrawerIfOpen();
                            await userManagementAction.searchUserByEmail(payload['Email Address']);
                            const finalCount = await userManagementPage.getUserRowCountByEmail(payload['Email Address']);
                            expect(finalCount).toBe(baselineCount);
                            throw new Error(
                                `Expected duplicate email validation but observed feedback: "${feedback || 'none'}"`,
                            );
                        }
                        await userManagementAction.closeDrawerIfOpen();
                        break;
                    }
                    case 'TC-UM-003': {
                        await userManagementAction.searchUserByEmail(payload['Email Address']);
                        await userManagementAction.openEditForUser(payload['Email Address']);
                        const roleEnabled = await userManagementPage.isRoleDropdownEnabled();
                        expect(roleEnabled, 'Role dropdown is disabled for this user in the Edit User drawer.').toBeTruthy();
                        if (payload.Role) {
                            await userManagementPage.selectRole(payload.Role);
                        }
                        await userManagementPage.saveUser();
                        notes = 'Edit drawer opened and role dropdown was editable.';
                        break;
                    }
                    case 'TC-UM-004': {
                        await userManagementAction.searchUserByEmail(payload['Email Address']);
                        await userManagementAction.deactivateUser(payload['Email Address']);
                        await expect(page.getByText(/Deactivate/i)).toBeVisible();
                        notes = 'Deactivate action opened its confirmation path.';
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
