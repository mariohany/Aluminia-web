import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';

const CODE_HEADER_HINTS = ['code', 'ral'];
const HEX_HEADER_HINTS = ['hex', 'color', 'colour'];

export interface ParsedColorRow {
  code: string;
  hex: string;
  rowNumber: number;
}

export interface ParsedColorSheet {
  rows: ParsedColorRow[];
  errors: string[];
}

// "6005", "ral6005", and "RAL 6005" are the same colour under three
// spellings — normalize a bare or loosely-formatted RAL number to
// "RAL NNNN" so an import matches existing RAL-prefixed rows instead of
// creating a near-duplicate. Anything that isn't a 3-4 digit RAL number
// (a custom/non-RAL code) passes through unchanged, just trimmed.
function normalizeCode(raw: string): string {
  const trimmed = raw.trim();
  const match = /^(?:ral)?\s*(\d{3,4})$/i.exec(trimmed);
  return match ? `RAL ${match[1]}` : trimmed;
}

// Accepts "#RRGGBB", "RRGGBB", or "rgb(r, g, b)" text — whatever a
// human typed into the cell. Anything else (a named colour, an actual
// cell fill instead of text) is reported as an error row rather than
// guessed at.
function normalizeHex(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const value = String(raw).trim();
  if (!value) return null;

  const hexMatch = /^#?([0-9a-fA-F]{6})$/.exec(value);
  if (hexMatch) return `#${hexMatch[1].toUpperCase()}`;

  const rgbMatch =
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i.exec(
      value,
    );
  if (rgbMatch) {
    const channels = rgbMatch.slice(1, 4).map(Number);
    if (channels.every((c) => c >= 0 && c <= 255)) {
      return `#${channels.map((c) => c.toString(16).padStart(2, '0').toUpperCase()).join('')}`;
    }
  }
  return null;
}

function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return '';
  const value = cell.value;
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  if (value && typeof value === 'object' && 'richText' in value) {
    return value.richText.map((part) => part.text).join('');
  }
  return '';
}

function findHeaderColumns(
  row: ExcelJS.Row,
): { codeCol: number; hexCol: number } | null {
  let codeCol = -1;
  let hexCol = -1;
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const label = cellText(cell).trim().toLowerCase();
    if (
      codeCol === -1 &&
      CODE_HEADER_HINTS.some((hint) => label.includes(hint))
    ) {
      codeCol = colNumber;
    }
    if (
      hexCol === -1 &&
      HEX_HEADER_HINTS.some((hint) => label.includes(hint))
    ) {
      hexCol = colNumber;
    }
  });
  return codeCol === -1 || hexCol === -1 ? null : { codeCol, hexCol };
}

// Header row isn't assumed to be row 1 — title rows and blank rows
// above it are common in hand-authored sheets — so the first 10 rows
// are scanned for one that has both a code-ish and a hex-ish header.
export async function parseColorWorkbook(
  buffer: Buffer,
): Promise<ParsedColorSheet> {
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

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new BadRequestException('The spreadsheet has no sheets.');

  let headerRowNumber = -1;
  let columns: { codeCol: number; hexCol: number } | null = null;
  for (let i = 1; i <= Math.min(sheet.rowCount, 10); i++) {
    const found = findHeaderColumns(sheet.getRow(i));
    if (found) {
      headerRowNumber = i;
      columns = found;
      break;
    }
  }
  if (!columns) {
    throw new BadRequestException(
      'Couldn\'t find header columns for the RAL code and hex value — the sheet needs a header row with columns like "Code"/"RAL" and "Hex"/"Color".',
    );
  }

  const rows: ParsedColorRow[] = [];
  const errors: string[] = [];
  for (let i = headerRowNumber + 1; i <= sheet.rowCount; i++) {
    const line = sheet.getRow(i);
    const codeText = cellText(line.getCell(columns.codeCol)).trim();
    const code = codeText ? normalizeCode(codeText) : codeText;
    const rawHex = line.getCell(columns.hexCol);
    const hexText = cellText(rawHex).trim();
    if (!code && !hexText) continue;
    if (!code) {
      errors.push(`Row ${i}: missing RAL code.`);
      continue;
    }
    const hex = normalizeHex(rawHex.value);
    if (!hex) {
      errors.push(`Row ${i}: missing or unrecognised hex value for "${code}".`);
      continue;
    }
    rows.push({ code, hex, rowNumber: i });
  }

  return { rows, errors };
}
