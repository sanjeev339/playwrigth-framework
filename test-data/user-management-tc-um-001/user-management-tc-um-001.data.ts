export const USER_MANAGEMENT_TC_UM_001_TEST_DATA = {
    userId: 'b2931c1b-7c34-4691-bc4e-1057807600ac',
    fullName: 'Priya Sharma',
    emailAddress: 'priya.sharma@acmesolutions.com',
    role: 'Executive',
    status: 'Pending',
    createdDate: '2026-04-01T12:00:00',
    createdBy: 'Client_admin01',
    baseUrl: 'https://adminportal.dev.eigen-dyne.com/login/',
    scenarioId: 'TC-UM-001',
    testCaseName: 'Verify successful manual user creation',
    expectedResult: '1. User Management page is displayed.; 2. Add User form is displayed.; 3. Full Name field shows the entered value.; 4. Email Address field shows the entered value.; 5. Role dropdown reflects the chosen role.; 6. User is visible in the list with correct status with status Pending.; Overall: New user is listed in User Management with Pending status.',
    passCriteria: 'User appears in the user list with status Pending.',
    dataStrategy: 'positive_valid_create',
    edgeCaseType: ''
} as const;

export type UserManagementTcUm001TestData = typeof USER_MANAGEMENT_TC_UM_001_TEST_DATA;
