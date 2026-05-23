export type UserManagementScenarioType =
    | 'positive_valid_create'
    | 'negative_invalid_create'
    | 'positive_valid_update'
    | 'status_change';

export type UserManagementPayload = {
    'First Name': string;
    'Last Name': string;
    'Full Name': string;
    'Email Address': string;
    Role?: string;
    Status?: string;
    'Created Date'?: string;
    'Created By'?: string;
    'Expected Error'?: string;
};

export type UserManagementScenario = {
    scenario_id: string;
    scenario_title: string;
    module_name: string;
    feature_name: string;
    execution_order: number;
    depends_on: string[];
    preconditions: string[];
    test_steps: string[];
    payload: UserManagementPayload;
    expected_result: string;
    validation_rules: string[];
    positive_or_negative_type: 'positive' | 'negative';
    edge_case_type: string | null;
    data_strategy: UserManagementScenarioType;
    source_files: string[];
};

export const userManagementScenarios: UserManagementScenario[] = [
    {
        scenario_id: 'TC-UM-001',
        scenario_title: 'Verify successful manual user creation',
        module_name: 'User Management',
        feature_name: 'User Creation & Invitations',
        execution_order: 1,
        depends_on: [],
        preconditions: [
            'Client admin is logged in.',
            'Permissions for user creation are granted.',
        ],
        test_steps: [
            'Navigate to User Management',
            'Click Add User and choose Add Internal User',
            'Enter first name and last name',
            'Enter email address',
            'Select role',
            'Click Save',
        ],
        payload: {
            'First Name': 'Priya',
            'Last Name': 'Sharma',
            'Full Name': 'Priya Sharma',
            'Email Address': 'priya.sharma+auto001@piraiinfotech.com',
            Role: 'Workflow Operators',
            Status: 'Pending',
            'Created Date': '2026-04-01T12:00:00',
            'Created By': 'Client_admin01',
        },
        expected_result:
            'New user is listed in User Management with Pending status.',
        validation_rules: [
            'Full Name: max 50 chars, alphabets and spaces only',
            'Email Address: max 100 chars, unique and valid format',
            'Role must exist in Role Management',
        ],
        positive_or_negative_type: 'positive',
        edge_case_type: null,
        data_strategy: 'positive_valid_create',
        source_files: ['input/UC_trail_pw 1.xlsx', 'input/test_data_enriched.json'],
    },
    {
        scenario_id: 'TC-UM-002',
        scenario_title: 'Validate unique user email constraint',
        module_name: 'User Management',
        feature_name: 'User Creation & Invitations',
        execution_order: 2,
        depends_on: ['TC-UM-001'],
        preconditions: [
            'A user with the same email already exists.',
            'Client admin is logged in.',
        ],
        test_steps: [
            'Navigate to User Management',
            'Click Add User and choose Add Internal User',
            'Enter duplicate email address',
            'Click Save',
        ],
        payload: {
            'First Name': 'adithya',
            'Last Name': 'j',
            'Full Name': 'adithya j',
            'Email Address': 'sanjeevkumar.m00@gmail.com',
            'Expected Error': 'Email already exists',
        },
        expected_result: 'System prevents duplicate email from being registered.',
        validation_rules: ['Email Address must not match any existing records'],
        positive_or_negative_type: 'negative',
        edge_case_type: 'duplicate_value',
        data_strategy: 'negative_invalid_create',
        source_files: ['input/UC_trail_pw 1.xlsx', 'input/test_data_enriched.json'],
    },
    {
        scenario_id: 'TC-UM-003',
        scenario_title: 'Verify role assignment to user',
        module_name: 'User Management',
        feature_name: 'Role Assignment',
        execution_order: 3,
        depends_on: ['TC-UM-001'],
        preconditions: [
            'User is created and exists in the system.',
            'Administrator is logged in and viewing user details.',
        ],
        test_steps: [
            'Navigate to User Management',
            'Open user actions and click Edit',
            'Select role from Role dropdown',
            'Click Save',
        ],
        payload: {
            'First Name': 'adithya',
            'Last Name': 'j',
            'Full Name': 'adithya j',
            'Email Address': 'sanjeevkumar.m00@gmail.com',
            Role: 'Workflow Operators',
        },
        expected_result: "User's assigned role reflects changes in the user list.",
        validation_rules: ['Role must exist in Role Management'],
        positive_or_negative_type: 'positive',
        edge_case_type: null,
        data_strategy: 'positive_valid_update',
        source_files: ['input/UC_trail_pw 1.xlsx', 'input/test_data_enriched.json'],
    },
    {
        scenario_id: 'TC-UM-004',
        scenario_title: 'Verify deactivation of a user',
        module_name: 'User Management',
        feature_name: 'User Status Management',
        execution_order: 4,
        depends_on: ['TC-UM-001'],
        preconditions: [
            'User is active and exists in the system.',
            'Administrator is logged in.',
        ],
        test_steps: [
            'Navigate to User Management',
            'Open user actions',
            'Click Deactivate',
        ],
        payload: {
            'First Name': 'adithya',
            'Last Name': 'j',
            'Full Name': 'adithya j',
            'Email Address': 'sanjeevkumar.m00@gmail.com',
            Status: 'Deactivated',
        },
        expected_result: 'User status is updated to Deactivated.',
        validation_rules: ['Status must change from Active to Deactivated'],
        positive_or_negative_type: 'positive',
        edge_case_type: 'status_change',
        data_strategy: 'status_change',
        source_files: ['input/UC_trail_pw 1.xlsx', 'input/test_data_enriched.json'],
    },
];
