import path from 'node:path';
import fs from 'fs-extra';

const STATE_FILE_PATH = path.join(process.cwd(), 'tests', 'data', 'sharedState.json');

export function getSharedState(): Record<string, string> {
  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      return fs.readJsonSync(STATE_FILE_PATH);
    }
  } catch (error) {
    console.error('Error reading shared state:', error);
  }
  return {};
}

export function setSharedState(key: string, value: string): void {
  try {
    const state = getSharedState();
    state[key] = value;
    fs.ensureFileSync(STATE_FILE_PATH);
    fs.writeJsonSync(STATE_FILE_PATH, state, { spaces: 2 });
  } catch (error) {
    console.error(`Error writing shared state for key ${key}:`, error);
  }
}

export function clearSharedState(): void {
  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      fs.removeSync(STATE_FILE_PATH);
    }
  } catch (error) {
    console.error('Error clearing shared state:', error);
  }
}
