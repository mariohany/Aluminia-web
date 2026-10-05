import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Free dividers — docs/free_dividers_planing.md §2 (2026-10-05). The
 * section GRID (`column_widths`/`row_heights`, sections by `row`/`col`)
 * and the thin decorative arch `bars` are both replaced by one thing:
 * dividers drawn point to point, each end anchored on a side of the clear
 * opening or on an earlier divider, in a new `window_dividers` table.
 * Sections become the LIGHTS those dividers make, identified by
 * `face_key` — the sorted ids of the members around the light — and keep
 * the editor's display order in `position`.
 *
 * Conversion, per panel:
 *
 * 1. Grid → dividers. Mullion `m<k>` runs sill → top at the k-th column
 *    boundary, THROUGH every transom (Q4: mullions run through). Transom
 *    row boundary j becomes `t<j>` — or one piece per column, `t<j>a`,
 *    `t<j>b`, …, each spanning between its two neighbouring verticals.
 *    Mm anchors: x from the left on horizontal hosts, up from the bottom
 *    on vertical ones (the contract's rule).
 * 2. An arched panel with rows > 1: its springing line WAS the top
 *    transom's top face, with the stored rise pinned to `row_heights[0]`.
 *    Rise becomes the drawn rise, `row_heights[0] − 41` (half the
 *    placeholder divider face — exactly what `buildWindowLayout` drew),
 *    and the top transom is now simply a transom: the picture is the same.
 * 3. Bars → dividers (Q8: they become real transoms). Ids `b<id>`;
 *    `'arch'` → `'head'` keeping the fraction; a bar on a bar keeps its
 *    fraction, except on a bar that converts to an exactly vertical or
 *    horizontal straight divider, whose anchors are mm by the contract's
 *    rule. A `'sill'` (springing line) anchor needs a real member now:
 *    the top transom on a gridded panel, otherwise a new springing
 *    transom `spring` (top face on the springing line, today's snap
 *    convention) inserted first. Its x is the old fraction of the old
 *    glass width.
 * 4. Sections: a grid cell's key is built from its four neighbours. A
 *    panel whose bars were converted can't have its new arch lights'
 *    keys computed here (that needs the light graph, apps/web only): its
 *    top-row section is written as `migrated:0`, and the editor re-keys
 *    it on first open, copying its settings to every new light (arch
 *    lights forced fixed) and flagging `lightsChanged`.
 * 5. Drop `column_widths`, `row_heights`, `bars` (their CHECKs go with
 *    them) and `row`/`col` (+ their CHECKs and UNIQUE index).
 *
 * The arch maths in step 3 is a FROZEN copy of apps/web's
 * arch-geometry.ts as of this migration (placeholder 52 mm frame face) —
 * a migration must keep producing the same rows whatever that file
 * becomes later.
 *
 * `down()` restores the grid only where the dividers are still exactly a
 * converted grid (ids `m<k>`, `t<j>`/`t<j><letter>`, no `migrated:`
 * keys); anything drawn freely since, or converted from bars, can't be
 * represented on the old shape and throws, naming the window. Converted
 * bars are never turned back into bars.
 */
export class FreeDividers1788900000000 implements MigrationInterface {
  name = 'FreeDividers1788900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "window_dividers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "panel_id" uuid NOT NULL
          REFERENCES "window_panels"("id") ON DELETE CASCADE,
        "position" integer NOT NULL,
        "divider_key" varchar(40) NOT NULL,
        "from_on" varchar(40) NOT NULL,
        "from_at" double precision NOT NULL,
        "to_on" varchar(40) NOT NULL,
        "to_at" double precision NOT NULL,
        "sag_mm" integer NOT NULL DEFAULT 0,
        "profile_platform_id" uuid,
        "profile_company_id" uuid
          REFERENCES "company_system_profile"("id") ON DELETE RESTRICT,
        "cut_length_mm" double precision NOT NULL DEFAULT 0,
        "cut_from_left_deg" double precision NOT NULL DEFAULT 0,
        "cut_from_right_deg" double precision NOT NULL DEFAULT 0,
        "cut_to_left_deg" double precision NOT NULL DEFAULT 0,
        "cut_to_right_deg" double precision NOT NULL DEFAULT 0,
        CONSTRAINT "CK_window_dividers_profile" CHECK (num_nonnulls("profile_platform_id", "profile_company_id") <= 1),
        CONSTRAINT "CK_window_dividers_position_non_negative" CHECK ("position" >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_window_dividers_panel" ON "window_dividers" ("panel_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_window_dividers_profile_platform" ON "window_dividers" ("profile_platform_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_window_dividers_profile_company" ON "window_dividers" ("profile_company_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_window_dividers_panel_key" ON "window_dividers" ("panel_id", "divider_key")`,
    );

    await queryRunner.query(`
      ALTER TABLE "window_sections"
        ADD COLUMN "position" integer,
        ADD COLUMN "face_key" varchar(400)
    `);

    const panels = (await queryRunner.query(`
      SELECT "id", "window_id", "width_mm", "height_mm", "head_shape", "head_rise_mm",
             "column_widths", "row_heights", "bars"
      FROM "window_panels"
    `)) as OldPanel[];
    const sections = (await queryRunner.query(`
      SELECT s."id", s."panel_id", s."row", s."col", s."section_kind"
      FROM "window_sections" s
    `)) as OldSection[];
    const sectionsByPanel = new Map<string, OldSection[]>();
    for (const s of sections) {
      const list = sectionsByPanel.get(s.panel_id) ?? [];
      list.push(s);
      sectionsByPanel.set(s.panel_id, list);
    }

    let converted = 0;
    for (const panel of panels) {
      const plan = convertPanel(panel, sectionsByPanel.get(panel.id) ?? []);
      if (plan.hadBars) converted++;
      for (const [position, d] of plan.dividers.entries()) {
        await queryRunner.query(
          `INSERT INTO "window_dividers" ("panel_id", "position", "divider_key", "from_on", "from_at", "to_on", "to_at", "sag_mm")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            panel.id,
            position,
            d.id,
            d.from.on,
            d.from.at,
            d.to.on,
            d.to.at,
            d.sagMm,
          ],
        );
      }
      for (const s of plan.sections) {
        await queryRunner.query(
          `UPDATE "window_sections" SET "position" = $2, "face_key" = $3 WHERE "id" = $1`,
          [s.id, s.position, s.faceKey],
        );
      }
      if (plan.headRiseMm !== undefined) {
        await queryRunner.query(
          `UPDATE "window_panels" SET "head_rise_mm" = $2 WHERE "id" = $1`,
          [panel.id, plan.headRiseMm],
        );
      }
    }
    if (converted > 0) {
      console.log(
        `FreeDividers: ${converted} arched panel(s) had their glazing bars converted to transoms; their arch glass is now split into lights.`,
      );
    }

    await queryRunner.query(`
      ALTER TABLE "window_sections"
        ALTER COLUMN "position" SET NOT NULL,
        ALTER COLUMN "face_key" SET NOT NULL
    `);
    await queryRunner.query(`DROP INDEX "UQ_window_sections_panel_row_col"`);
    await queryRunner.query(`
      ALTER TABLE "window_sections"
        DROP CONSTRAINT "CK_window_sections_row_non_negative",
        DROP CONSTRAINT "CK_window_sections_col_non_negative",
        DROP COLUMN "row",
        DROP COLUMN "col"
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_window_sections_panel_face" ON "window_sections" ("panel_id", "face_key")`,
    );
    await queryRunner.query(`
      ALTER TABLE "window_panels"
        DROP COLUMN "column_widths",
        DROP COLUMN "row_heights",
        DROP COLUMN "bars"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const panels = (await queryRunner.query(
      `SELECT "id", "window_id", "width_mm", "height_mm", "head_shape", "head_rise_mm" FROM "window_panels"`,
    )) as {
      id: string;
      window_id: string;
      width_mm: number;
      height_mm: number;
      head_shape: string;
      head_rise_mm: number | null;
    }[];
    const dividers = (await queryRunner.query(
      `SELECT "panel_id", "divider_key", "from_on", "from_at", "to_on", "to_at" FROM "window_dividers" ORDER BY "position"`,
    )) as {
      panel_id: string;
      divider_key: string;
      from_on: string;
      from_at: number;
      to_on: string;
      to_at: number;
    }[];
    const sections = (await queryRunner.query(
      `SELECT "id", "panel_id", "face_key" FROM "window_sections"`,
    )) as { id: string; panel_id: string; face_key: string }[];

    const grids = new Map<
      string,
      {
        columns: number[];
        rows: number[];
        cells: Map<string, [number, number]>;
        rise: number | null;
      }
    >();
    for (const p of panels) {
      const mine = dividers.filter((d) => d.panel_id === p.id);
      const bad = mine.find((d) => !/^(m\d+|t\d+[a-z]?)$/.test(d.divider_key));
      const migrated = sections.find(
        (s) => s.panel_id === p.id && s.face_key.startsWith('migrated:'),
      );
      if (bad || migrated) {
        throw new Error(
          `FreeDividers down(): window ${p.window_id} has freely drawn dividers or converted bars, which the grid shape can't represent.`,
        );
      }
      const xs = [
        ...new Set(
          mine
            .filter((d) => d.divider_key.startsWith('m'))
            .map((d) => d.from_at),
        ),
      ].sort((a, b) => a - b);
      const ys = [
        ...new Set(
          mine
            .filter((d) => d.divider_key.startsWith('t'))
            .map((d) => p.height_mm - d.from_at),
        ),
      ].sort((a, b) => a - b);
      const columns = pitches([0, ...xs, p.width_mm]);
      const rows = pitches([0, ...ys, p.height_mm]);
      const cells = new Map<string, [number, number]>();
      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < columns.length; c++)
          cells.set(
            gridCellKey(
              r,
              c,
              rows.length,
              columns.length,
              p.head_shape !== 'flat',
            ),
            [r, c],
          );
      }
      const rise =
        p.head_shape !== 'flat' && rows.length > 1 ? rows[0] : p.head_rise_mm;
      grids.set(p.id, { columns, rows, cells, rise });
    }

    await queryRunner.query(`
      ALTER TABLE "window_panels"
        ADD COLUMN "column_widths" jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN "row_heights" jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN "bars" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "window_panels"
        ADD CONSTRAINT "CK_window_panels_bars_flat" CHECK ("head_shape" <> 'flat' OR "bars" = '[]'::jsonb)
    `);
    await queryRunner.query(
      `ALTER TABLE "window_sections" ADD COLUMN "row" integer, ADD COLUMN "col" integer`,
    );
    for (const [panelId, g] of grids) {
      await queryRunner.query(
        `UPDATE "window_panels" SET "column_widths" = $2, "row_heights" = $3, "head_rise_mm" = $4 WHERE "id" = $1`,
        [panelId, JSON.stringify(g.columns), JSON.stringify(g.rows), g.rise],
      );
      for (const s of sections.filter((x) => x.panel_id === panelId)) {
        const cell = g.cells.get(s.face_key);
        if (!cell)
          throw new Error(
            `FreeDividers down(): light "${s.face_key}" is not a grid cell.`,
          );
        await queryRunner.query(
          `UPDATE "window_sections" SET "row" = $2, "col" = $3 WHERE "id" = $1`,
          [s.id, cell[0], cell[1]],
        );
      }
    }
    await queryRunner.query(`DROP INDEX "UQ_window_sections_panel_face"`);
    await queryRunner.query(`
      ALTER TABLE "window_sections"
        ALTER COLUMN "row" SET NOT NULL,
        ALTER COLUMN "col" SET NOT NULL,
        ADD CONSTRAINT "CK_window_sections_row_non_negative" CHECK ("row" >= 0),
        ADD CONSTRAINT "CK_window_sections_col_non_negative" CHECK ("col" >= 0),
        DROP COLUMN "position",
        DROP COLUMN "face_key"
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_window_sections_panel_row_col" ON "window_sections" ("panel_id", "row", "col")`,
    );
    await queryRunner.query(`DROP TABLE "window_dividers"`);
  }
}

// ---- Conversion ---------------------------------------------------------

interface OldPanel {
  id: string;
  window_id: string;
  width_mm: number;
  height_mm: number;
  head_shape: string;
  head_rise_mm: number | null;
  column_widths: number[];
  row_heights: number[];
  bars: OldBar[];
}
interface OldSection {
  id: string;
  panel_id: string;
  row: number;
  col: number;
  section_kind: string;
}
interface OldBar {
  id: string;
  from: { on: string; at: number };
  to: { on: string; at: number };
  sagMm: number;
}
interface Anchor {
  on: string;
  at: number;
}
interface Divider {
  id: string;
  from: Anchor;
  to: Anchor;
  sagMm: number;
}

// Placeholder metrics every panel drew with at the time of this
// migration (apps/web profile-metrics.ts PLACEHOLDER_METRICS).
const FRAME_FACE = 52;
const HALF_DIVIDER = 41;
const BEAD_FACE = 18;
const SASH_FACE = 70;

function pitches(boundaries: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < boundaries.length; i++)
    out.push(boundaries[i + 1] - boundaries[i]);
  return out;
}

function letter(i: number): string {
  return String.fromCharCode(97 + i);
}

function transomId(j: number, c: number, cols: number): string {
  return cols === 1 ? `t${j}` : `t${j}${letter(c)}`;
}

/** The face key of grid cell (r, c): its four neighbours, sorted — the
 * same key apps/web's light graph computes for that light. */
function gridCellKey(
  r: number,
  c: number,
  rows: number,
  cols: number,
  arched: boolean,
): string {
  const left = c === 0 ? 'left' : `m${c}`;
  const right = c === cols - 1 ? 'right' : `m${c + 1}`;
  const top = r === 0 ? (arched ? 'head' : 'top') : transomId(r, c, cols);
  const bottom = r === rows - 1 ? 'sill' : transomId(r + 1, c, cols);
  // An arched top cell also touches the short jamb stubs between the
  // springing points and its bottom transom; both are already listed.
  return [...new Set([left, right, top, bottom])].sort().join('|');
}

export function convertPanel(
  panel: OldPanel,
  sections: OldSection[],
): {
  dividers: Divider[];
  sections: { id: string; position: number; faceKey: string }[];
  headRiseMm?: number;
  hadBars: boolean;
} {
  const H = panel.height_mm;
  const cols = panel.column_widths.length || 1;
  const rows = panel.row_heights.length || 1;
  const arched = panel.head_shape !== 'flat';
  const xB = [0];
  for (const w of panel.column_widths) xB.push(xB[xB.length - 1] + w);
  const yB = [0];
  for (const h of panel.row_heights) yB.push(yB[yB.length - 1] + h);

  const dividers: Divider[] = [];
  for (let k = 1; k < cols; k++) {
    dividers.push({
      id: `m${k}`,
      from: { on: 'sill', at: xB[k] },
      to: { on: arched ? 'head' : 'top', at: xB[k] },
      sagMm: 0,
    });
  }
  for (let j = 1; j < rows; j++) {
    const at = H - yB[j];
    for (let c = 0; c < cols; c++) {
      dividers.push({
        id: transomId(j, c, cols),
        from: { on: c === 0 ? 'left' : `m${c}`, at },
        to: { on: c === cols - 1 ? 'right' : `m${c + 1}`, at },
        sagMm: 0,
      });
    }
  }

  let headRiseMm: number | undefined;
  if (arched && rows > 1)
    headRiseMm = Math.max(Math.round(panel.row_heights[0] - HALF_DIVIDER), 1);

  const bars = Array.isArray(panel.bars) ? panel.bars : [];
  const hadBars = arched && bars.length > 0;
  if (hadBars)
    dividers.push(...convertBars(panel, bars, rows, headRiseMm, sections));

  const ordered = [...sections].sort((a, b) => a.row - b.row || a.col - b.col);
  const out = ordered.map((s, position) => ({
    id: s.id,
    position,
    faceKey:
      hadBars && s.row === 0
        ? 'migrated:0'
        : gridCellKey(s.row, s.col, rows, cols, arched),
  }));
  return {
    dividers: moveSpringFirst(dividers),
    sections: out,
    headRiseMm,
    hadBars,
  };
}

function moveSpringFirst(dividers: Divider[]): Divider[] {
  const spring = dividers.find((d) => d.id === 'spring');
  return spring ? [spring, ...dividers.filter((d) => d !== spring)] : dividers;
}

function convertBars(
  panel: OldPanel,
  bars: OldBar[],
  rows: number,
  newRise: number | undefined,
  sections: OldSection[],
): Divider[] {
  const W = panel.width_mm;
  const H = panel.height_mm;
  const shape = panel.head_shape;
  const rise = normalizeHeadRise(
    shape,
    W,
    newRise ?? panel.head_rise_mm ?? 0,
    H,
  );
  const inner = insetHeadOutline(
    { rect: { x: 0, y: 0, width: W, height: H }, shape, riseMm: rise },
    FRAME_FACE,
  );
  const springY = inner.rect.y + inner.riseMm;

  // The old 'sill' fraction ran across the top-row glass, inset by bead
  // (fixed) or sash (opening) from the frame.
  const top = sections.find((s) => s.row === 0 && s.col === 0);
  const glassInset =
    FRAME_FACE + (top?.section_kind === 'opening' ? SASH_FACE : BEAD_FACE);
  const glassX = glassInset;
  const glassW = Math.max(W - 2 * glassInset, 1);

  const sillHost = rows > 1 ? 't1' : 'spring';
  const out: Divider[] = [];
  if (
    rows === 1 &&
    bars.some((b) => b.from.on === 'sill' || b.to.on === 'sill')
  ) {
    const at = H - (springY + HALF_DIVIDER);
    out.push({
      id: 'spring',
      from: { on: 'left', at },
      to: { on: 'right', at },
      sagMm: 0,
    });
  }

  // Resolve every converted divider in the NEW geometry so a host that
  // came out exactly vertical/horizontal can have its dependents' fraction
  // anchors turned into mm.
  const points = new Map<
    string,
    { from: P; to: P; sag: number; axis: 'h' | 'v' | null }
  >();
  const springLineY = rows > 1 ? panel.row_heights[0] : springY + HALF_DIVIDER;
  const resolve = (a: Anchor): P | null => {
    if (a.on === 'head') return headPointAt(inner, a.at);
    if (a.on === sillHost) return { x: a.at, y: springLineY };
    const host = points.get(a.on);
    if (!host) return null;
    if (host.axis === 'v') return { x: host.from.x, y: H - a.at };
    if (host.axis === 'h') return { x: a.at, y: host.from.y };
    return pointAlongArc(host.from, host.to, host.sag, a.at);
  };
  const convertAnchor = (a: { on: string; at: number }): Anchor => {
    if (a.on === 'arch') return { on: 'head', at: a.at };
    if (a.on === 'sill') return { on: sillHost, at: glassX + a.at * glassW };
    const hostId = `b${a.on}`;
    const host = points.get(hostId);
    if (host?.axis === 'v')
      return {
        on: hostId,
        at: H - pointAlongArc(host.from, host.to, 0, a.at).y,
      };
    if (host?.axis === 'h')
      return { on: hostId, at: pointAlongArc(host.from, host.to, 0, a.at).x };
    return { on: hostId, at: a.at };
  };
  for (const bar of bars) {
    const d: Divider = {
      id: `b${bar.id}`,
      from: convertAnchor(bar.from),
      to: convertAnchor(bar.to),
      sagMm: Math.round(bar.sagMm),
    };
    const from = resolve(d.from);
    const to = resolve(d.to);
    if (from && to) {
      const axis =
        d.sagMm !== 0
          ? null
          : Math.abs(from.x - to.x) < 1e-6
            ? 'v'
            : Math.abs(from.y - to.y) < 1e-6
              ? 'h'
              : null;
      points.set(d.id, { from, to, sag: d.sagMm, axis });
    }
    out.push(d);
  }
  return out;
}

// ---- Frozen arch maths (apps/web/src/lib/arch-geometry.ts, 2026-10-05) ----

interface P {
  x: number;
  y: number;
}
interface Outline {
  rect: { x: number; y: number; width: number; height: number };
  shape: string;
  riseMm: number;
}
interface Arc {
  cx: number;
  cy: number;
  r: number;
}

function normalizeHeadRise(
  shape: string,
  widthMm: number,
  riseMm: number,
  heightMm: number,
): number {
  if (shape === 'flat') return 0;
  const raw = shape === 'round' ? widthMm / 2 : riseMm;
  return Math.min(raw, heightMm - 1);
}
function segmentalArc(o: Outline): Arc {
  const hw = o.rect.width / 2;
  const r = (hw * hw + o.riseMm * o.riseMm) / (2 * o.riseMm);
  return { cx: o.rect.x + hw, cy: o.rect.y + r, r };
}
function gothicArcs(o: Outline): { left: Arc; right: Arc } {
  const hw = o.rect.width / 2;
  const m = (o.riseMm * o.riseMm - hw * hw) / (2 * hw);
  const y = o.rect.y + o.riseMm;
  const cx = o.rect.x + hw;
  return {
    left: { cx: cx + m, cy: y, r: hw + m },
    right: { cx: cx - m, cy: y, r: hw + m },
  };
}
function pointOnArc(arc: Arc, phi: number): P {
  return {
    x: arc.cx + arc.r * Math.sin(phi),
    y: arc.cy - arc.r * Math.cos(phi),
  };
}
function gothicSweep(o: Outline, arcs: { left: Arc }): number {
  const m = arcs.left.r - o.rect.width / 2;
  return Math.PI / 2 - Math.atan2(m, o.riseMm);
}
function headPointAt(o: Outline, t: number): P {
  const c = Math.min(Math.max(t, 0), 1);
  if (o.shape === 'gothic') {
    const arcs = gothicArcs(o);
    const sweep = gothicSweep(o, arcs);
    if (c <= 0.5)
      return pointOnArc(arcs.left, -Math.PI / 2 + (c / 0.5) * sweep);
    return pointOnArc(
      arcs.right,
      Math.PI / 2 - sweep + ((c - 0.5) / 0.5) * sweep,
    );
  }
  const arc = segmentalArc(o);
  const half = Math.atan2(o.rect.width / 2, arc.r - o.riseMm);
  return pointOnArc(arc, -half + c * 2 * half);
}
function insetHeadOutline(o: Outline, d: number): Outline {
  const maxD = Math.min(
    o.rect.width / 2 - 0.5,
    o.rect.height / 2 - 0.5,
    o.riseMm - 0.5,
  );
  const cd = Math.min(Math.max(d, 0), Math.max(maxD, 0));
  const newX = o.rect.x + cd;
  const newWidth = Math.max(o.rect.width - 2 * cd, 1);
  const bottomY = o.rect.y + o.rect.height - cd;
  const crossingAt = (arc: Arc): P | null => {
    const dx = newX - arc.cx;
    const under = arc.r * arc.r - dx * dx;
    return under < 0 ? null : { x: newX, y: arc.cy - Math.sqrt(under) };
  };
  if (o.shape === 'gothic') {
    const arcs = gothicArcs(o);
    const rNew = Math.max(arcs.left.r - cd, 0.5);
    const left = { ...arcs.left, r: rNew };
    const crossing = crossingAt(left) ?? { x: newX, y: arcs.left.cy };
    const dx = o.rect.x + o.rect.width / 2 - left.cx;
    const apexY = Math.min(
      left.cy - Math.sqrt(Math.max(left.r * left.r - dx * dx, 0)),
      crossing.y - 0.5,
    );
    return {
      rect: {
        x: newX,
        y: apexY,
        width: newWidth,
        height: Math.max(bottomY - apexY, 1),
      },
      shape: 'gothic',
      riseMm: Math.max(crossing.y - apexY, 1),
    };
  }
  const arc = segmentalArc(o);
  const rNew = Math.max(arc.r - cd, 0.5);
  const crossing = crossingAt({ ...arc, r: rNew }) ?? {
    x: newX,
    y: arc.cy - rNew,
  };
  const apexY = arc.cy - rNew;
  return {
    rect: {
      x: newX,
      y: apexY,
      width: newWidth,
      height: Math.max(bottomY - apexY, 1),
    },
    shape: o.shape,
    riseMm: Math.max(crossing.y - apexY, 1),
  };
}
/** A point at fraction `t` along a straight or bowed bar — the arch-bar
 * construction (sag along the chord's left normal), sampled by angle. */
function pointAlongArc(from: P, to: P, sag: number, t: number): P {
  const chord = Math.hypot(to.x - from.x, to.y - from.y);
  if (sag === 0 || chord === 0)
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  const s = Math.abs(sag);
  const r = (chord * chord) / (8 * s) + s / 2;
  const dir = { x: (to.x - from.x) / chord, y: (to.y - from.y) / chord };
  const perp = { x: -dir.y, y: dir.x };
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const sign = sag > 0 ? 1 : -1;
  const c = {
    x: mid.x + perp.x * (sag - r * sign),
    y: mid.y + perp.y * (sag - r * sign),
  };
  const peak = { x: mid.x + perp.x * sag, y: mid.y + perp.y * sag };
  const a0 = Math.atan2(from.y - c.y, from.x - c.x);
  const ap = Math.atan2(peak.y - c.y, peak.x - c.x);
  let half = (ap - a0) % (2 * Math.PI);
  if (half > Math.PI) half -= 2 * Math.PI;
  if (half <= -Math.PI) half += 2 * Math.PI;
  const phi = a0 + 2 * half * t;
  return { x: c.x + r * Math.cos(phi), y: c.y + r * Math.sin(phi) };
}
