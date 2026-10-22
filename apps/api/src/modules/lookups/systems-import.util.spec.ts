import ExcelJS from 'exceljs';
import { parseSystemsWorkbook } from './systems-import.util';

const HEADER = [
  'Catalogue',
  'Profile no.',
  'Profile type',
  'Max glass thickness',
  'Weight',
  'Perimeter',
  'Inertia Ix',
  'Inertia Iy',
];

async function profileSheet(
  extraHeader: string[],
  rows: (string | number | null)[][],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Profile');
  sheet.addRow([...HEADER, ...extraHeader]);
  for (const row of rows) {
    sheet.addRow([
      'S67',
      ...row.slice(0, 1),
      'Frame',
      24,
      1,
      100,
      1,
      1,
      ...row.slice(1),
    ]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// docs/mitre_cuts_planing.md §4.
describe('parseSystemsWorkbook: face width', () => {
  it('reads the column: a number, a blank cell as null, bad values as row errors', async () => {
    const parsed = await parseSystemsWorkbook(
      await profileSheet(
        ['Face width (mm)'],
        [
          ['P1', 45.5],
          ['P2', null],
          ['P3', 0],
          ['P4', 45.55],
          ['P5', 501],
        ],
      ),
    );
    expect(parsed.profiles.map((p) => [p.profileNo, p.faceWidthMm])).toEqual([
      ['P1', 45.5],
      ['P2', null],
    ]);
    expect(parsed.errors).toHaveLength(3);
    expect(parsed.errors[0]).toMatch(/Profile row 4: face width/);
  });

  it('no column: undefined, so an update keeps the profile’s own', async () => {
    const parsed = await parseSystemsWorkbook(await profileSheet([], [['P1']]));
    expect(parsed.profiles[0].faceWidthMm).toBeUndefined();
    expect(parsed.errors).toEqual([]);
  });
});
