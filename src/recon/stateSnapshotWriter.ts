import path from 'node:path';
import type { ReconSnapshot } from '../types';
import { slugify, writeJsonFile } from '../utils/fileUtils';

export async function writeStateSnapshot(
  snapshot: ReconSnapshot,
  scenarioDir: string,
  sequence: number
): Promise<string> {
  const stateSlug = slugify(snapshot.state, 'state');
  const fileName = `${String(sequence).padStart(2, '0')}-${stateSlug}.json`;
  const outputPath = path.join(scenarioDir, fileName);
  await writeJsonFile(outputPath, {
    ...snapshot,
    decision: snapshot.decision ?? null
  });
  return outputPath;
}
