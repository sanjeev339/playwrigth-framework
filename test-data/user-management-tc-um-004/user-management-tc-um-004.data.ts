export const USER_MANAGEMENT_TC_UM_004_TEST_DATA = {
  userId: 'e4c1484f-6d11-4eab-b5c5-34c04bc2651e',
  status: 'Deactivated',
  baseUrl: 'https://adminportal.dev.eigen-dyne.com/login/',
  scenarioId: 'TC-UM-004',
  testCaseName: 'Verify deactivation of a user',
  expectedResult: '1. User Management page is displayed.; 2. User details are displayed.; 3. User status is updated to Deactivated.; Overall: User cannot sign in post-deactivation.',
  passCriteria: 'User status reflects Deactivated.',
  dataStrategy: 'positive_valid_create',
  edgeCaseType: ''
};