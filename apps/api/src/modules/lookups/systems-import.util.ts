import { BadRequestException } from '@nestjs/common';
import { ProfileType, SystemType } from '@repo/types/lookups';
import type ExcelJS from 'exceljs';
import {
  cellNumber,
  cellText,
  findHeaderRow,
  findSheetByName,
  loadWorkbook,
} from './excel-import.util';

const BRAND_SHEET_NAMES = ['brand', 'brands'];
const CATALOG_SHEET_NAMES = ['catalogue', 'catalogues', 'catalog', 'catalogs'];
const PROFILE_SHEET_NAMES = ['profile', 'profiles'];

// Accepts the UI's own labels ("Curtain wall") and the raw enum code
// ("curtain_wall") interchangeably — a human filling in the sheet by
// hand shouldn't need to know the code, but a re-export of already
//-imported data (which would use the code) should still round-trip.
const SYSTEM_TYPE_LABELS: Record<string, SystemType> = {
  sliding: SystemType.SLIDING,
  hinged: SystemType.HINGED,
  'curtain wall': SystemType.CURTAIN_WALL,
  curtain_wall: SystemType.CURTAIN_WALL,
};

const PROFILE_TYPE_LABELS: Record<string, ProfileType> = {
  frame: ProfileType.FRAME,
  leaf: ProfileType.LEAF,
  transom: ProfileType.TRANSOM,
  'glass beading': ProfileType.GLASS_BEADING,
  glass_beading: ProfileType.GLASS_BEADING,
  insert: ProfileType.INSERT,
  'sliding insert': ProfileType.SLIDING_INSERT,
  sliding_insert: ProfileType.SLIDING_INSERT,
  'control rod': ProfileType.CONTROL_ROD,
  control_rod: ProfileType.CONTROL_ROD,
  'bottom rail': ProfileType.BOTTOM_RAIL,
  bottom_rail: ProfileType.BOTTOM_RAIL,
};

function normalizeEnumLabel(text: string): string {
  return text.trim().toLowerCase();
}

const TRUTHY_TEXT = new Set(['yes', 'y', 'true', '1']);

// The Fly screen column is optional and new — absent entirely, or blank
// on a given row, both mean "no" rather than an error, so every
// workbook users already hold keeps importing unchanged.
function cellBoolean(cell: ExcelJS.Cell | undefined): boolean {
  return TRUTHY_TEXT.has(cellText(cell).trim().toLowerCase());
}

export interface ParsedBrandRow {
  name: string;
  rowNumber: number;
}

export interface ParsedCatalogRow {
  brandName: string;
  name: string;
  systemType: SystemType;
  maxGlassThickness: number;
  maxSashWeight: number;
  rowNumber: number;
}

export interface ParsedProfileRow {
  catalogName: string;
  profileNo: string;
  profileType: ProfileType;
  maxGlassThickness: number;
  weight: number;
  perimeter: number;
  inertiaIx: number;
  inertiaIy: number;
  image: string | null;
  acceptsFlyScreen: boolean;
  rowNumber: number;
}

export interface ParsedSystemsWorkbook {
  brands: ParsedBrandRow[];
  catalogs: ParsedCatalogRow[];
  profiles: ParsedProfileRow[];
  // Sheet-prefixed, e.g. "Brand row 4: ...", separate from the
  // per-table errors the service adds later for unresolved references.
  errors: string[];
}

function findColumns(
  row: ExcelJS.Row,
  specs: { key: string; hints: string[] }[],
): Record<string, number> | null {
  const found: Record<string, number> = {};
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const label = cellText(cell).trim().toLowerCase();
    for (const spec of specs) {
      if (
        found[spec.key] === undefined &&
        spec.hints.some((h) => label.includes(h))
      ) {
        found[spec.key] = colNumber;
      }
    }
  });
  return specs.every((spec) => found[spec.key] !== undefined) ? found : null;
}

function parseBrandSheet(
  sheet: ExcelJS.Worksheet,
  errors: string[],
): ParsedBrandRow[] {
  const header = findHeaderRow(sheet, (row) =>
    findColumns(row, [{ key: 'name', hints: ['name'] }]),
  );
  if (!header) {
    errors.push('Brand sheet: couldn\'t find a "Name" column.');
    return [];
  }
  const rows: ParsedBrandRow[] = [];
  for (let i = header.rowNumber + 1; i <= sheet.rowCount; i++) {
    const line = sheet.getRow(i);
    const name = cellText(line.getCell(header.columns.name)).trim();
    if (!name) continue;
    rows.push({ name, rowNumber: i });
  }
  return rows;
}

function parseCatalogSheet(
  sheet: ExcelJS.Worksheet,
  errors: string[],
): ParsedCatalogRow[] {
  const header = findHeaderRow(sheet, (row) =>
    findColumns(row, [
      { key: 'brand', hints: ['brand'] },
      { key: 'name', hints: ['name'] },
      { key: 'systemType', hints: ['system type', 'type'] },
      {
        key: 'maxGlassThickness',
        hints: ['max glass thickness', 'glass thickness'],
      },
      { key: 'maxSashWeight', hints: ['max sash weight', 'sash weight'] },
    ]),
  );
  if (!header) {
    errors.push(
      "Catalogue sheet: couldn't find all required columns (Brand, Name, System type, Max glass thickness, Max sash weight).",
    );
    return [];
  }
  const rows: ParsedCatalogRow[] = [];
  for (let i = header.rowNumber + 1; i <= sheet.rowCount; i++) {
    const line = sheet.getRow(i);
    const brandName = cellText(line.getCell(header.columns.brand)).trim();
    const name = cellText(line.getCell(header.columns.name)).trim();
    const systemTypeText = cellText(
      line.getCell(header.columns.systemType),
    ).trim();
    if (!brandName && !name && !systemTypeText) continue;

    if (!brandName || !name) {
      errors.push(`Catalogue row ${i}: missing Brand or Name.`);
      continue;
    }
    const systemType = SYSTEM_TYPE_LABELS[normalizeEnumLabel(systemTypeText)];
    if (!systemType) {
      errors.push(
        `Catalogue row ${i}: unrecognised system type "${systemTypeText}" (expected Sliding, Hinged, or Curtain wall).`,
      );
      continue;
    }
    const maxGlassThickness = cellNumber(
      line.getCell(header.columns.maxGlassThickness),
    );
    const maxSashWeight = cellNumber(
      line.getCell(header.columns.maxSashWeight),
    );
    if (maxGlassThickness === null || maxSashWeight === null) {
      errors.push(
        `Catalogue row ${i}: max glass thickness and max sash weight must be numbers.`,
      );
      continue;
    }
    rows.push({
      brandName,
      name,
      systemType,
      maxGlassThickness,
      maxSashWeight,
      rowNumber: i,
    });
  }
  return rows;
}

function parseProfileSheet(
  sheet: ExcelJS.Worksheet,
  errors: string[],
): ParsedProfileRow[] {
  const header = findHeaderRow(sheet, (row) =>
    findColumns(row, [
      { key: 'catalog', hints: ['catalogue', 'catalog'] },
      { key: 'profileNo', hints: ['profile no', 'profile number'] },
      { key: 'profileType', hints: ['profile type'] },
      {
        key: 'maxGlassThickness',
        hints: ['max glass thickness', 'glass thickness'],
      },
      { key: 'weight', hints: ['weight'] },
      { key: 'perimeter', hints: ['perimeter'] },
      { key: 'inertiaIx', hints: ['inertia ix', 'ix'] },
      { key: 'inertiaIy', hints: ['inertia iy', 'iy'] },
    ]),
  );
  if (!header) {
    errors.push(
      "Profile sheet: couldn't find all required columns (Catalogue, Profile no., Profile type, Max glass thickness, Weight, Perimeter, Inertia Ix, Inertia Iy).",
    );
    return [];
  }
  // Image and Fly screen are both optional — looked up separately so
  // their absence doesn't block the required-columns check above.
  const imageHeader = findColumns(sheet.getRow(header.rowNumber), [
    { key: 'image', hints: ['image', 'url'] },
  ]);
  const flyScreenHeader = findColumns(sheet.getRow(header.rowNumber), [
    { key: 'acceptsFlyScreen', hints: ['fly screen', 'flyscreen'] },
  ]);

  const rows: ParsedProfileRow[] = [];
  for (let i = header.rowNumber + 1; i <= sheet.rowCount; i++) {
    const line = sheet.getRow(i);
    const catalogName = cellText(line.getCell(header.columns.catalog)).trim();
    const profileNo = cellText(line.getCell(header.columns.profileNo)).trim();
    const profileTypeText = cellText(
      line.getCell(header.columns.profileType),
    ).trim();
    if (!catalogName && !profileNo && !profileTypeText) continue;

    if (!catalogName || !profileNo) {
      errors.push(`Profile row ${i}: missing Catalogue or Profile no.`);
      continue;
    }
    const profileType =
      PROFILE_TYPE_LABELS[normalizeEnumLabel(profileTypeText)];
    if (!profileType) {
      errors.push(
        `Profile row ${i}: unrecognised profile type "${profileTypeText}".`,
      );
      continue;
    }
    const maxGlassThickness = cellNumber(
      line.getCell(header.columns.maxGlassThickness),
    );
    const weight = cellNumber(line.getCell(header.columns.weight));
    const perimeter = cellNumber(line.getCell(header.columns.perimeter));
    const inertiaIx = cellNumber(line.getCell(header.columns.inertiaIx));
    const inertiaIy = cellNumber(line.getCell(header.columns.inertiaIy));
    if (
      maxGlassThickness === null ||
      weight === null ||
      perimeter === null ||
      inertiaIx === null ||
      inertiaIy === null
    ) {
      errors.push(
        `Profile row ${i}: max glass thickness, weight, perimeter, inertia Ix and inertia Iy must all be numbers.`,
      );
      continue;
    }
    const image = imageHeader
      ? cellText(line.getCell(imageHeader.image)).trim() || null
      : null;
    const acceptsFlyScreen = flyScreenHeader
      ? cellBoolean(line.getCell(flyScreenHeader.acceptsFlyScreen))
      : false;
    rows.push({
      catalogName,
      profileNo,
      profileType,
      maxGlassThickness,
      weight,
      perimeter,
      inertiaIx,
      inertiaIy,
      image,
      acceptsFlyScreen,
      rowNumber: i,
    });
  }
  return rows;
}

// Sheets are matched by exact tab name ("Brand"/"Catalogue"/"Profile",
// case-insensitive), not by header content or position — a sheet not
// present is simply skipped (that table isn't part of this import), but
// if a sheet IS present it must have all its required columns or it
// contributes a sheet-level error and no rows.
export async function parseSystemsWorkbook(
  buffer: Buffer,
): Promise<ParsedSystemsWorkbook> {
  const workbook = await loadWorkbook(buffer);
  const errors: string[] = [];

  const brandSheet = findSheetByName(workbook, BRAND_SHEET_NAMES);
  const catalogSheet = findSheetByName(workbook, CATALOG_SHEET_NAMES);
  const profileSheet = findSheetByName(workbook, PROFILE_SHEET_NAMES);

  if (!brandSheet && !catalogSheet && !profileSheet) {
    throw new BadRequestException(
      'No "Brand", "Catalogue", or "Profile" sheet found in that file — the tabs must be named exactly one of those.',
    );
  }

  return {
    brands: brandSheet ? parseBrandSheet(brandSheet, errors) : [],
    catalogs: catalogSheet ? parseCatalogSheet(catalogSheet, errors) : [],
    profiles: profileSheet ? parseProfileSheet(profileSheet, errors) : [],
    errors,
  };
}
