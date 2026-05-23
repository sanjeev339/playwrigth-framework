# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: user_management/userManagement.spec.ts >> User Management data-driven scenarios >> TC-UM-003 - Verify role assignment to user
- Location: tests/user_management/userManagement.spec.ts:24:13

# Error details

```
Error: Role dropdown is disabled for this user in the Edit User drawer.

expect(received).toBeTruthy()

Received: false
```

# Test source

```ts
  1   | import { expect, test } from '../../fixtures/test.fixture';
  2   | import { userManagementScenarios } from '../../test-data/user_management/userManagement.scenarios';
  3   | 
  4   | type ScenarioResult = {
  5   |     scenarioId: string;
  6   |     scenarioTitle: string;
  7   |     outcome: 'passed' | 'failed';
  8   |     notes: string;
  9   | };
  10  | 
  11  | test.describe('User Management data-driven scenarios', () => {
  12  |     const executionResults: ScenarioResult[] = [];
  13  | 
  14  |     test.beforeEach(async ({ loginAction, userManagementAction }) => {
  15  |         await loginAction.loginAndWaitForLoad();
  16  |         await userManagementAction.navigateToUserManagement();
  17  |     });
  18  | 
  19  |     test.afterAll(async () => {
  20  |         console.table(executionResults);
  21  |     });
  22  | 
  23  |     for (const scenario of userManagementScenarios.sort((a, b) => a.execution_order - b.execution_order)) {
  24  |         test(`${scenario.scenario_id} - ${scenario.scenario_title}`, async ({
  25  |             page,
  26  |             userManagementAction,
  27  |             userManagementPage,
  28  |         }) => {
  29  |             const payload = scenario.payload;
  30  |             let notes = '';
  31  | 
  32  |             try {
  33  |                 switch (scenario.scenario_id) {
  34  |                     case 'TC-UM-001': {
  35  |                         await userManagementAction.createInternalUser({
  36  |                             firstName: payload['First Name'],
  37  |                             lastName: payload['Last Name'],
  38  |                             email: payload['Email Address'],
  39  |                             role: payload.Role,
  40  |                         });
  41  |                         await userManagementAction.searchUserByEmail(payload['Email Address']);
  42  |                         await expect(userManagementPage.userRowByEmail(payload['Email Address'])).toBeVisible();
  43  |                         notes = 'User row became visible after create flow.';
  44  |                         break;
  45  |                     }
  46  |                     case 'TC-UM-002': {
  47  |                         await userManagementAction.searchUserByEmail(payload['Email Address']);
  48  |                         const baselineCount = await userManagementPage.getUserRowCountByEmail(payload['Email Address']);
  49  |                         await userManagementPage.searchInput.clear();
  50  |                         await userManagementAction.createInternalUser({
  51  |                             firstName: payload['First Name'],
  52  |                             lastName: payload['Last Name'],
  53  |                             email: payload['Email Address'],
  54  |                         });
  55  |                         const feedback = await userManagementAction.getFeedbackMessage();
  56  |                         if (feedback.toLowerCase().includes((payload['Expected Error'] ?? '').toLowerCase())) {
  57  |                             notes = `Validation message observed: ${feedback}`;
  58  |                         } else {
  59  |                             await userManagementAction.closeDrawerIfOpen();
  60  |                             await userManagementAction.searchUserByEmail(payload['Email Address']);
  61  |                             const finalCount = await userManagementPage.getUserRowCountByEmail(payload['Email Address']);
  62  |                             expect(finalCount).toBe(baselineCount);
  63  |                             throw new Error(
  64  |                                 `Expected duplicate email validation but observed feedback: "${feedback || 'none'}"`,
  65  |                             );
  66  |                         }
  67  |                         await userManagementAction.closeDrawerIfOpen();
  68  |                         break;
  69  |                     }
  70  |                     case 'TC-UM-003': {
  71  |                         await userManagementAction.searchUserByEmail(payload['Email Address']);
  72  |                         await userManagementAction.openEditForUser(payload['Email Address']);
  73  |                         const roleEnabled = await userManagementPage.isRoleDropdownEnabled();
> 74  |                         expect(roleEnabled, 'Role dropdown is disabled for this user in the Edit User drawer.').toBeTruthy();
      |                                                                                                                 ^ Error: Role dropdown is disabled for this user in the Edit User drawer.
  75  |                         if (payload.Role) {
  76  |                             await userManagementPage.selectRole(payload.Role);
  77  |                         }
  78  |                         await userManagementPage.saveUser();
  79  |                         notes = 'Edit drawer opened and role dropdown was editable.';
  80  |                         break;
  81  |                     }
  82  |                     case 'TC-UM-004': {
  83  |                         await userManagementAction.searchUserByEmail(payload['Email Address']);
  84  |                         await userManagementAction.deactivateUser(payload['Email Address']);
  85  |                         await expect(page.getByText(/Deactivate/i)).toBeVisible();
  86  |                         notes = 'Deactivate action opened its confirmation path.';
  87  |                         break;
  88  |                     }
  89  |                     default:
  90  |                         throw new Error(`Unhandled scenario ${scenario.scenario_id}`);
  91  |                 }
  92  | 
  93  |                 executionResults.push({
  94  |                     scenarioId: scenario.scenario_id,
  95  |                     scenarioTitle: scenario.scenario_title,
  96  |                     outcome: 'passed',
  97  |                     notes,
  98  |                 });
  99  |             } catch (error) {
  100 |                 executionResults.push({
  101 |                     scenarioId: scenario.scenario_id,
  102 |                     scenarioTitle: scenario.scenario_title,
  103 |                     outcome: 'failed',
  104 |                     notes: error instanceof Error ? error.message : String(error),
  105 |                 });
  106 |                 throw error;
  107 |             }
  108 |         });
  109 |     }
  110 | });
  111 | 
```