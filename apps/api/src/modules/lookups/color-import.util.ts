import { BadRequestException } from '@nestjs/common';
import type ExcelJS from 'exceljs';
import {
  cellText,
  findHeaderRow,
  findSheetByName,
  loadWorkbook,
} from './excel-import.util';

const CODE_HEADER_HINTS = ['code', 'ral'];
const HEX_HEADER_HINTS = ['hex', 'color', 'colour'];
const COLOR_SHEET_NAMES = ['color', 'colors', 'colour', 'colours'];

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

// A sheet named "Colors"/"Colour"/etc. is used if present — this way a
// combined workbook (e.g. one that also has Brand/Catalogue/Profile
// sheets for the systems importer, which matches by name too) doesn't
// need its colour data to be in any particular position. Falls back to
// the first sheet for older colour-only files that predate this
// convention and were never named anything in particular.
export async function parseColorWorkbook(
  buffer: Buffer,
): Promise<ParsedColorSheet> {
  const workbook = await loadWorkbook(buffer);

  const sheet =
    findSheetByName(workbook, COLOR_SHEET_NAMES) ?? workbook.worksheets[0];
  if (!sheet) throw new BadRequestException('The spreadsheet has no sheets.');

  const header = findHeaderRow(sheet, findHeaderColumns);
  if (!header) {
    throw new BadRequestException(
      'Couldn\'t find header columns for the RAL code and hex value — the sheet needs a header row with columns like "Code"/"RAL" and "Hex"/"Color".',
    );
  }
  const { rowNumber: headerRowNumber, columns } = header;

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
