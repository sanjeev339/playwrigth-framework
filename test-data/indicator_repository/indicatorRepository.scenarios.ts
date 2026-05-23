export type IndicatorScenario = {
    scenario_id: string;
    scenario_title: string;
    module_name: string;
    feature_name: string;
    execution_order: number;
    depends_on: string[];
    preconditions: string[];
    test_steps: string[];
    payload: Record<string, string>;
    expected_result: string;
    validation_rules: string[];
    positive_or_negative_type: 'positive' | 'negative';
    edge_case_type: string | null;
    data_strategy: string;
    source_files: string[];
};

export const indicatorRepositoryScenarios: IndicatorScenario[] = [
    {
        scenario_id: 'TC-PF-001',
        scenario_title: 'Create Pillar - Valid Data Input',
        module_name: 'Pillars Configuration',
        feature_name: 'Add Pillar',
        execution_order: 1,
        depends_on: [],
        preconditions: ['User is a Back Office Admin.', 'User is logged in.'],
        test_steps: [
            'Navigate to Indicator Repository and click on Pillars.',
            'Click New Pillar.',
            'Enter Pillar Name and Description.',
            'Click Save.',
        ],
        payload: {
            'Pillar Name': 'Environmental Impact',
            'Pillar Description': 'Tracks environmental impacts..',
            Status: 'Active',
        },
        expected_result:
            "Pillar 'Environmental Impact' is created and appears in the list with status Active.",
        validation_rules: [
            'Pillar Name: Text, 3-100 characters, unique globally',
            'Pillar Description: Text, maximum 500 characters',
            'Status: Active/Inactive, default Active',
        ],
        positive_or_negative_type: 'positive',
        edge_case_type: null,
        data_strategy: 'positive_valid_create',
        source_files: ['input/tc11_1-6 (1).xlsx', 'input/test_data (1) (1).json'],
    },
    {
        scenario_id: 'TC-TO-002',
        scenario_title: 'Create Topic - Valid Input',
        module_name: 'Topics Management',
        feature_name: 'CRUD Operations',
        execution_order: 2,
        depends_on: ['TC-PF-001'],
        preconditions: ['User is logged in as Back Office.', "Pillar 'Environmental Impact' exists."],
        test_steps: [
            'Navigate to Indicator Repository and click on Topics.',
            'Click Add New Topic.',
            'Select Pillar from the dropdown.',
            'Enter Topic Name.',
            'Click Save.',
        ],
        payload: {
            Pillar: 'Environmental Impact',
            'Topic Name': 'Climate Change',
            'Framework Name': 'Climate Change',
            Status: 'Active',
        },
        expected_result:
            "The topic 'Climate Change' appears in the list associated with 'Environmental Impact'.",
        validation_rules: ['Name: Alphanumeric, 3-150 chars', 'Pillar must reference an existing Pillar'],
        positive_or_negative_type: 'positive',
        edge_case_type: null,
        data_strategy: 'positive_valid_create',
        source_files: ['input/tc11_1-6 (1).xlsx', 'input/test_data (1) (1).json'],
    },
    {
        scenario_id: 'TC-DM-003',
        scenario_title: 'Create Disclosure with Valid Data',
        module_name: 'Disclosure Management',
        feature_name: 'Create Disclosure',
        execution_order: 3,
        depends_on: ['TC-TO-002'],
        preconditions: [
            'User with Back Office role is logged in.',
            'Pillar and Topic exist and are selectable on the Add Disclosure form.',
        ],
        test_steps: [
            'Navigate to Indicator Repository and click on Disclosure.',
            'Click Add New Disclosure.',
            'Select Pillar from the dropdown.',
            'Select Topic from the dropdown.',
            'Enter Disclosure Code.',
            'Enter Disclosure Name.',
            'Click Save.',
        ],
        payload: {
            Pillar: 'Environmental Impact',
            Topic: 'Climate Change',
            'Disclosure Code': 'DISC-2025-001',
            'Disclosure Name': 'Direct GHG Emissions',
            Status: 'Active',
        },
        expected_result:
            "New disclosure 'DISC-2025-001' appears in the list with status Active under topic 'Climate Change'.",
        validation_rules: [
            'Disclosure Code: Unique, 2-50 chars',
            'Disclosure Name: 3-200 chars',
            'Topic must exist',
            'Default Status: Active',
        ],
        positive_or_negative_type: 'positive',
        edge_case_type: null,
        data_strategy: 'positive_valid_create',
        source_files: ['input/tc11_1-6 (1).xlsx', 'input/test_data (1) (1).json'],
    },
];
