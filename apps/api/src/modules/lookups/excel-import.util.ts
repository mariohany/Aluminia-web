import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';

// Shared by every Excel importer in this module (colours, systems).
export async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs's bundled type declares `load` against a differently
    // resolved `Buffer` than @types/node's generic `Buffer<T>` here —
    // a type-only mismatch, not a runtime one, so `any` sidesteps it.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await workbook.xlsx.load(buffer as any);
  } catch {
    throw new BadRequestException(
      'Could not read that file as an Excel spreadsheet.',
    );
  }
  return workbook;
}

export function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return '';
  const value = cell.value;
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  if (value && typeof value === 'object' && 'richText' in value) {
    return value.richText.map((part) => part.text).join('');
  }
  return '';
}

export function cellNumber(cell: ExcelJS.Cell | undefined): number | null {
  if (!cell) return null;
  const value = cell.value;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// Scans the first 10 rows for one whose header cells satisfy `match` —
// title rows and blank rows above the real header are common in
// hand-authored sheets, so the header isn't assumed to be row 1.
export function findHeaderRow<T>(
  sheet: ExcelJS.Worksheet,
  match: (row: ExcelJS.Row) => T | null,
): { rowNumber: number; columns: T } | null {
  for (let i = 1; i <= Math.min(sheet.rowCount, 10); i++) {
    const found = match(sheet.getRow(i));
    if (found) return { rowNumber: i, columns: found };
  }
  return null;
}

// Finds a worksheet whose (trimmed, lowercased) name is in `names`.
export function findSheetByName(
  workbook: ExcelJS.Workbook,
  names: string[],
): ExcelJS.Worksheet | undefined {
  return workbook.worksheets.find((sheet) =>
    names.includes(sheet.name.trim().toLowerCase()),
  );
}
