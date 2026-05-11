import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

export interface UserManagementScenario {
  scenarioId: string;
  scenarioTitle: string;
  priority: string;
  preConditions: string;
  testSteps: string;
  expectedResult: string;
  passFail: string;
  notes: string;
}

/**
 * Reads and maps test scenarios from Trial_UserMgmt.xlsx.
 */
export class ExcelDataReader {
  
  /**
   * Resolves the Excel file path.
   * Prioritizes the test-data directory within the project.
   */
  private static resolveExcelPath(): string {
    const candidates = [
      path.join(__dirname, 'Trial_UserMgmt.xlsx'), // Current dir (test-data/)
      path.join(process.cwd(), 'test-data/Trial_UserMgmt.xlsx'),
      path.join(process.cwd(), 'Trial_UserMgmt.xlsx'),
    ];
    
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    throw new Error(
      `Trial_UserMgmt.xlsx not found. Searched:\n${candidates.join('\n')}`
    );
  }

  /**
   * Loads all user management scenarios from the Excel file.
   */
  static loadScenarios(sheetName = '01_Manual_Creation'): UserManagementScenario[] {
    const filePath = this.resolveExcelPath();
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
      throw new Error(
        `Sheet "${sheetName}" not found. Available sheets: ${workbook.SheetNames.join(', ')}`
      );
    }

    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
    }) as any[][];

    const scenarios: UserManagementScenario[] = [];

    // Row 0 = title, Row 1 = headers → data starts at row index 2
    for (let i = 2; i < rows.length; i++) {
      const r = rows[i];
      // scenarioId is in Column A (index 0)
      const scenarioId = String(r[0] ?? '').trim();
      if (!scenarioId || !scenarioId.startsWith('UM-')) continue;

      scenarios.push({
        scenarioId,
        scenarioTitle:  String(r[1] ?? '').trim(),
        priority:       String(r[2] ?? '').trim(),
        preConditions:  String(r[3] ?? '').trim(),
        testSteps:      String(r[4] ?? '').trim(),
        expectedResult: String(r[5] ?? '').trim(),
        passFail:       String(r[6] ?? '').trim(),
        notes:          String(r[7] ?? '').trim(),
      });
    }

    return scenarios;
  }

  /** Convenience: get one scenario by ID */
  static getScenarioById(id: string): UserManagementScenario {
    const all = this.loadScenarios();
    const found = all.find(s => s.scenarioId === id);
    if (!found) throw new Error(`Scenario "${id}" not found in Excel.`);
    return found;
  }
}
