import { SystemType } from '@repo/types/lookups';
import {
  GlassKind,
  HeadShape,
  HingedOpeningType,
  SectionKind,
  type WindowDividerInput,
  type WindowPanelInput,
  type WindowSectionInput,
} from '@repo/types/windows';
import {
  buildCutList,
  type CutMember,
  type CutPiece,
} from '@repo/geometry/cut-list';
import { PLACEHOLDER_METRICS } from '@repo/geometry/profile-metrics';
import { panelLights } from '@repo/geometry/panel-lights';

// docs/reports_planing.md §3. Stand-in widths: frame 45, sash 60,
// divider 50, bead 8 (PLACEHOLDER_METRICS).
const F = PLACEHOLDER_METRICS.frameFace;
const D = PLACEHOLDER_METRICS.dividerFace;
const B = PLACEHOLDER_METRICS.beadFace;

const HINGED = { systemType: SystemType.HINGED, flyScreenAllowed: false };
const SLIDING = { systemType: SystemType.SLIDING, flyScreenAllowed: false };

function fixed(
  beadProfile: string | null = 'platform:bead',
): WindowSectionInput {
  return {
    faceKey: 'x',
    kind: SectionKind.FIXED,
    sashProfile: null,
    beadProfile,
    openingType: null,
    glassKind: GlassKind.SINGLE,
    glass: 'platform:glass',
    hasFlyScreen: false,
    sliding: null,
  };
}

function opening(sashProfile = 'platform:sash'): WindowSectionInput {
  return {
    ...fixed(null),
    kind: SectionKind.OPENING,
    sashProfile,
    openingType: HingedOpeningType.SIDE_HUNG_LEFT,
  };
}

function divider(
  id: string,
  from: { on: string; at: number },
  to: { on: string; at: number },
  profile: string | null = null,
): WindowDividerInput {
  return {
    id,
    from,
    to,
    sagMm: 0,
    profile,
    cut: {
      lengthMm: 0,
      fromLeftDeg: 0,
      fromRightDeg: 0,
      toLeftDeg: 0,
      toRightDeg: 0,
    },
  };
}

// Sections are matched to lights by `faceKey` (panel-lights.ts), so give
// each one its light's real key, in display order, as a saved window has.
function panel(over: Partial<WindowPanelInput>): WindowPanelInput {
  const p = basePanel(over);
  const { lights } = panelLights(p, {
    metrics: PLACEHOLDER_METRICS,
    doorSill: false,
  }).graph;
  return {
    ...p,
    sections: p.sections.map((s, i) => ({
      ...s,
      faceKey: lights[i]?.key ?? s.faceKey,
    })),
  };
}

function basePanel(over: Partial<WindowPanelInput>): WindowPanelInput {
  return {
    xMm: 0,
    yMm: 0,
    widthMm: 1000,
    heightMm: 1500,
    frameProfile: 'platform:frame',
    dividerProfile: 'platform:transom',
    dividers: [],
    sections: [fixed()],
    isDoor: false,
    headShape: HeadShape.FLAT,
    headRiseMm: null,
    ...over,
  };
}

const lengths = (pieces: CutPiece[], member: CutMember) =>
  pieces
    .filter((p) => p.member === member)
    .map((p) => p.lengthMm)
    .sort((a, b) => b - a);

describe('buildCutList', () => {
  it('fixed light: mitred frame at outer size, butt beads inside', () => {
    const { pieces, skipped } = buildCutList({
      panels: [panel({})],
      facts: [HINGED],
      quantity: 1,
    });
    expect(skipped).toEqual([]);
    expect(lengths(pieces, 'frame')).toEqual([1500, 1500, 1000, 1000]);
    // Clear opening 910 × 1410: top/bottom full width, sides between.
    const clearW = 1000 - 2 * F;
    const clearH = 1500 - 2 * F;
    expect(lengths(pieces, 'bead')).toEqual([
      clearH - 2 * B,
      clearH - 2 * B,
      clearW,
      clearW,
    ]);
    expect(pieces.every((p) => p.profile && !p.curved)).toBe(true);
  });

  it('casement: two sashes either side of a mullion, no beads on sashes', () => {
    const { pieces } = buildCutList({
      panels: [
        panel({
          widthMm: 1200,
          heightMm: 1200,
          dividers: [
            divider('m', { on: 'sill', at: 600 }, { on: 'top', at: 600 }),
          ],
          sections: [opening(), opening()],
        }),
      ],
      facts: [HINGED],
      quantity: 1,
    });
    expect(lengths(pieces, 'divider')).toEqual([1200 - 2 * F]);
    const sashW = 600 - D / 2 - F;
    const sashH = 1200 - 2 * F;
    expect(lengths(pieces, 'sash')).toEqual([
      sashH,
      sashH,
      sashH,
      sashH,
      sashW,
      sashW,
      sashW,
      sashW,
    ]);
    expect(lengths(pieces, 'bead')).toEqual([]);
    const mullion = pieces.find((p) => p.member === 'divider');
    expect(mullion?.at.divider).toEqual({ kind: 'mullion', number: 1 });
    expect(mullion?.profile).toBe('platform:transom');
  });

  it('W-01 2400 × 1500: fixed top light over a transom, two sashes and a mullion', () => {
    // Transom 1080 up from the sill; mullion from the sill to the transom.
    const { pieces } = buildCutList({
      panels: [
        panel({
          widthMm: 2400,
          heightMm: 1500,
          dividers: [
            divider('t', { on: 'left', at: 1080 }, { on: 'right', at: 1080 }),
            divider('m', { on: 'sill', at: 1200 }, { on: 't', at: 1200 }),
          ],
          sections: [fixed(), opening(), opening()],
        }),
      ],
      facts: [HINGED],
      quantity: 4,
    });
    const topY = 1500 - 1080; // transom centre, from the top
    const topLightH = topY - D / 2 - F;
    const lowH = 1500 - F - (topY + D / 2);
    expect(lengths(pieces, 'frame')).toEqual([2400, 2400, 1500, 1500]);
    expect(lengths(pieces, 'divider')).toEqual([2400 - 2 * F, lowH]);
    expect(lengths(pieces, 'bead')).toEqual([
      2400 - 2 * F,
      2400 - 2 * F,
      topLightH - 2 * B,
      topLightH - 2 * B,
    ]);
    const sashW = 1200 - D / 2 - F;
    expect(lengths(pieces, 'sash')).toEqual([
      sashW,
      sashW,
      sashW,
      sashW,
      lowH,
      lowH,
      lowH,
      lowH,
    ]);
    expect(pieces.every((p) => p.count === 4)).toBe(true);
  });

  it('sliding: one ring per leaf, leaves overlapping by the interlock', () => {
    const { pieces } = buildCutList({
      panels: [
        panel({
          widthMm: 1800,
          heightMm: 1500,
          sections: [opening('platform:leaf')],
        }),
      ],
      facts: [SLIDING],
      quantity: 1,
    });
    const leafW = (1800 - 2 * F + PLACEHOLDER_METRICS.slidingInterlock) / 2;
    const leafH = 1500 - 2 * F;
    expect(lengths(pieces, 'sash')).toEqual([
      leafH,
      leafH,
      leafH,
      leafH,
      leafW,
      leafW,
      leafW,
      leafW,
    ]);
    expect(
      pieces.filter((p) => p.member === 'sash').map((p) => p.at.sashIndex),
    ).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
  });

  it('round head: the frame head is one curved piece of its arc length', () => {
    const { pieces } = buildCutList({
      panels: [
        panel({
          widthMm: 1000,
          heightMm: 1500,
          headShape: HeadShape.ROUND,
          headRiseMm: 500,
        }),
      ],
      facts: [HINGED],
      quantity: 1,
    });
    const frame = pieces.filter((p) => p.member === 'frame');
    const head = frame.filter((p) => p.curved);
    expect(head).toHaveLength(1);
    expect(head[0].lengthMm).toBe(Math.round(Math.PI * 500));
    expect(head[0].at.position).toBe('head');
    expect(frame.filter((p) => !p.curved).map((p) => p.lengthMm)).toEqual([
      1000, 1000, 1000,
    ]);
    // The fixed arched light's beads include a curved head too.
    expect(pieces.some((p) => p.member === 'bead' && p.curved)).toBe(true);
  });

  it('hinged door: no sill on the frame', () => {
    const { pieces } = buildCutList({
      panels: [
        panel({
          widthMm: 1000,
          heightMm: 2400,
          isDoor: true,
          sections: [opening('platform:door-leaf')],
        }),
      ],
      facts: [HINGED],
      quantity: 1,
    });
    expect(lengths(pieces, 'frame')).toEqual([2400, 2400, 1000]);
  });

  // docs/mitre_cuts_planing.md §3: the metal each piece really holds.
  describe('real metal (mitred ends)', () => {
    const metal = (pieces: CutPiece[], member: CutMember) =>
      pieces
        .filter((p) => p.member === member)
        .map((p) => [p.at.position, p.lengthMm, p.metalMm]);

    it('a rectangular ring: every piece L − w, beads all of L', () => {
      const { pieces } = buildCutList({
        panels: [panel({ widthMm: 1000, heightMm: 1500 })],
        facts: [HINGED],
        quantity: 1,
      });
      expect(metal(pieces, 'frame')).toEqual([
        ['top', 1000, 1000 - F],
        ['left', 1500, 1500 - F],
        ['right', 1500, 1500 - F],
        ['bottom', 1000, 1000 - F],
      ]);
      for (const bead of pieces.filter((p) => p.member === 'bead')) {
        expect(bead.metalMm).toBe(bead.lengthMm);
      }
    });

    it("the profile's own face width wins; a sash ring defaults to 60", () => {
      const { pieces } = buildCutList({
        panels: [panel({ sections: [opening()] })],
        facts: [HINGED],
        quantity: 1,
        faceWidthOf: (ref) => (ref === 'platform:frame' ? 70.5 : null),
      });
      const frame = pieces.filter((p) => p.member === 'frame');
      expect(frame.every((p) => p.metalMm === p.lengthMm - 70.5)).toBe(true);
      const sash = pieces.filter((p) => p.member === 'sash');
      expect(sash).toHaveLength(4);
      expect(
        sash.every(
          (p) => p.metalMm === p.lengthMm - PLACEHOLDER_METRICS.sashFace,
        ),
      ).toBe(true);
    });

    it('a hinged door: the jambs are square at the floor, L − w/2', () => {
      const { pieces } = buildCutList({
        panels: [
          panel({
            widthMm: 1000,
            heightMm: 2400,
            isDoor: true,
            sections: [opening('platform:door-leaf')],
          }),
        ],
        facts: [HINGED],
        quantity: 1,
      });
      expect(metal(pieces, 'frame')).toEqual([
        ['top', 1000, 1000 - F],
        ['left', 2400, 2400 - F / 2],
        ['right', 2400, 2400 - F / 2],
      ]);
    });

    it('a round head: the arc keeps all of L, the jambs lose only the sill corner', () => {
      const { pieces } = buildCutList({
        panels: [
          panel({
            widthMm: 1000,
            heightMm: 1500,
            headShape: HeadShape.ROUND,
            headRiseMm: 500,
          }),
        ],
        facts: [HINGED],
        quantity: 1,
      });
      const frame = pieces.filter((p) => p.member === 'frame');
      const head = frame.find((p) => p.curved)!;
      expect(head.metalMm).toBe(head.lengthMm);
      const jambs = frame.filter(
        (p) => p.at.position === 'left' || p.at.position === 'right',
      );
      expect(jambs.map((p) => p.metalMm)).toEqual([1000 - F / 2, 1000 - F / 2]);
      expect(frame.find((p) => p.at.position === 'bottom')!.metalMm).toBe(
        1000 - F,
      );
    });

    it('a gothic head: each arc loses (w/2)·tan θ at the apex', () => {
      const { pieces } = buildCutList({
        panels: [
          panel({
            widthMm: 1000,
            heightMm: 1800,
            headShape: HeadShape.GOTHIC,
            headRiseMm: 600,
          }),
        ],
        facts: [HINGED],
        quantity: 1,
      });
      const arcs = pieces.filter((p) => p.member === 'frame' && p.curved);
      expect(arcs).toHaveLength(2);
      for (const arc of arcs) {
        const loss = arc.lengthMm - arc.metalMm;
        // More than nothing, less than a full 45° end (w/2).
        expect(loss).toBeGreaterThan(0);
        expect(loss).toBeLessThan(F / 2);
      }
    });
  });

  it('a divider with no profile anywhere is skipped, not cut', () => {
    const { pieces, skipped } = buildCutList({
      panels: [
        panel({
          widthMm: 1200,
          dividerProfile: null,
          dividers: [
            divider('m', { on: 'sill', at: 600 }, { on: 'top', at: 600 }),
          ],
          sections: [fixed(), fixed()],
        }),
      ],
      facts: [HINGED],
      quantity: 1,
    });
    expect(lengths(pieces, 'divider')).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({
      member: 'divider',
      reason: 'noProfile',
      at: { panelIndex: 0, divider: { kind: 'mullion', number: 1 } },
    });
  });

  it('a divider uses its own profile over the panel default', () => {
    const { pieces } = buildCutList({
      panels: [
        panel({
          widthMm: 1200,
          dividers: [
            divider(
              'm',
              { on: 'sill', at: 600 },
              { on: 'top', at: 600 },
              'company:heavy',
            ),
          ],
          sections: [fixed(), fixed()],
        }),
      ],
      facts: [HINGED],
      quantity: 1,
    });
    expect(pieces.find((p) => p.member === 'divider')?.profile).toBe(
      'company:heavy',
    );
  });
});
