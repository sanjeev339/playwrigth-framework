export const USER_MANAGEMENT_TC_UM_003_TEST_DATA = {
    userId: '4024e4a0-badd-470d-86d7-0b8c3a89815e',
    role: 'Manager',
    scenarioId: 'TC-UM-003',
    testCaseName: 'Verify role assignment to user',
    expectedResult: "User's assigned role reflects changes in the user list.",
    passCriteria: 'User role matches the assigned role.',
    dataStrategy: 'positive_valid_create',
    edgeCaseType: '',
} as const;

export type UserManagementTcUm003TestData = typeof USER_MANAGEMENT_TC_UM_003_TEST_DATA;
