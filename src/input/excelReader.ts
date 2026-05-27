import fs from 'fs-extra';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import type { TestFlowRow } from '../types';
import { resolveFromRoot } from '../utils/fileUtils';

const aliases = {
  scenario_id: ['scenario_id', 'scenario id', 'scenarioid', 'tc id', 'test case id', 'testcaseid'],
  module: ['module', 'feature', 'area'],
  action: ['action', 'business action', 'flow action'],
  step_no: ['step_no', 'step no', 'step number', 'step', 'order', 'sequence'],
  instruction: ['instruction', 'step instruction', 'test step', 'test steps', 'step description', 'step'],
  expected_result: ['expected_result', 'expected result', 'expected results', 'expected', 'expected outcome']
} as const;

const rowSchema = z.object({
  scenario_id: z.string().min(1, 'scenario_id is required'),
  module: z.string().optional(),
  action: z.string().optional(),
  step_no: z.number().optional(),
  instruction: z.string().min(1, 'instruction is required'),
  expected_result: z.string().optional()
});

export async function readExcelRows(filePath = resolveFromRoot('input', 'test_flow.xlsx')): Promise<TestFlowRow[]> {
  if (!(await fs.pathExists(filePath))) {
    throw new Error(`Excel file not found at ${filePath}`);
  }

  console.log(`Reading Excel: ${filePath}`);
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  console.log(`Detected sheets: ${workbook.SheetNames.join(', ')}`);
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error(`Excel workbook has no sheets: ${filePath}`);
  }

  console.log(`Selected sheet: ${firstSheetName}`);
  const sheet = workbook.Sheets[firstSheetName];
  
  const rangeStr = sheet['!ref'] || 'A1:A1';
  const range = XLSX.utils.decode_range(rangeStr);
  const headers: string[] = [];
  for (let C = range.s.c; C <= range.e.c; ++C) {
    const cell = sheet[XLSX.utils.encode_cell({c: C, r: range.s.r})];
    if (cell && cell.v !== undefined) {
      headers.push(String(cell.v));
    }
  }
  console.log(`Detected headers: ${headers.join(', ')}`);

  const normalizedHeaders = headers.map(normalizeHeader);
  const hasScenarioId = aliases.scenario_id.some((a) => normalizedHeaders.includes(normalizeHeader(a)));
  const hasInstruction = aliases.instruction.some((a) => normalizedHeaders.includes(normalizeHeader(a)));

  if (!hasScenarioId || !hasInstruction) {
    throw new Error("Missing required Excel columns: scenario_id, instruction");
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    blankrows: false
  });

  const rows = rawRows
    .map((row, index) => normalizeRow(row, index + 2))
    .filter((row): row is TestFlowRow => row !== null);

  if (rows.length === 0) {
    throw new Error(`No valid rows found in ${filePath}`);
  }
  
  console.log(`Parsed rows: ${rows.length}`);
  console.log(`First parsed row preview: ${JSON.stringify(rows[0])}`);

  return rows.sort((left, right) => {
    const scenarioComparison = left.scenario_id.localeCompare(right.scenario_id);
    if (scenarioComparison !== 0) {
      return scenarioComparison;
    }

    if (left.step_no !== undefined && right.step_no !== undefined) {
      return left.step_no - right.step_no;
    }

    return 0;
  });
}

function normalizeRow(row: Record<string, unknown>, excelRowNumber: number): TestFlowRow | null {
  const byNormalizedHeader = new Map<string, unknown>();

  for (const [header, value] of Object.entries(row)) {
    byNormalizedHeader.set(normalizeHeader(header), value);
  }

  const parsed = {
    scenario_id: stringify(readByAlias(byNormalizedHeader, aliases.scenario_id)),
    module: stringify(readByAlias(byNormalizedHeader, aliases.module)) || undefined,
    action: stringify(readByAlias(byNormalizedHeader, aliases.action)) || undefined,
    step_no: parseStepNumber(readByAlias(byNormalizedHeader, aliases.step_no)),
    instruction: stringify(readByAlias(byNormalizedHeader, aliases.instruction)),
    expected_result: stringify(readByAlias(byNormalizedHeader, aliases.expected_result)) || undefined
  };

  const isEmpty = !parsed.scenario_id && !parsed.instruction;
  if (isEmpty) {
    return null;
  }

  try {
    return rowSchema.parse(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      throw new Error(`Invalid Excel row ${excelRowNumber}: ${details}`);
    }
    throw error;
  }
}

function readByAlias(headers: Map<string, unknown>, aliasList: readonly string[]): unknown {
  for (const alias of aliasList) {
    const normalizedAlias = normalizeHeader(alias);
    if (headers.has(normalizedAlias)) {
      return headers.get(normalizedAlias);
    }
  }

  return undefined;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

function parseStepNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

if (require.main === module) {
  readExcelRows()
    .then((rows) => {
      console.log(JSON.stringify(rows, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
