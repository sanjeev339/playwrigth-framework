import { buildDeterministicReconTest } from '../src/llm/generatorPromptBuilder';
import { readJsonFile } from '../src/utils/fileUtils';
import { getFrameworkPaths } from '../src/config/env';
import path from 'path';

async function test() {
  const paths = getFrameworkPaths();
  const scenario = await readJsonFile<any>(path.join(paths.scenarioDir, 'TC-UM-006.json'));
  const actions = await readJsonFile<any>(path.join(paths.reconSummaryDir, 'TC-UM-006.actions.json'));
  
  const code = buildDeterministicReconTest(scenario, actions);
  console.log('--- GENERATED CODE ---');
  console.log(code);
}

test().catch(console.error);
