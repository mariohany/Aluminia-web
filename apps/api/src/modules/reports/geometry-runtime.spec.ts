import { SystemType } from '@repo/types/lookups';
import { GlassKind, HeadShape, SectionKind } from '@repo/types/windows';
import type { WindowPanelInput } from '@repo/types/windows';
import { panelLayoutInput } from '@repo/geometry/panel-geometry';
import { buildAssemblyLayout } from '@repo/geometry/window-geometry';
import { PLACEHOLDER_METRICS } from '@repo/geometry/profile-metrics';

// The API builds windows with the same geometry the editor draws with
// (docs/reports_planing.md §5). This proves the wiring: @repo/geometry's
// files import each other with `.ts` extensions, which the API's tsc
// (`rewriteRelativeImportExtensions`), ts-jest (the `.js` mapper) and
// Node's runtime type stripping must all accept.
describe('@repo/geometry on the API', () => {
  const section = (faceKey: string) => ({
    faceKey,
    kind: SectionKind.FIXED,
    sashProfile: null,
    beadProfile: null,
    openingType: null,
    glassKind: GlassKind.SINGLE,
    glass: 'platform:glass',
    hasFlyScreen: false,
    sliding: null,
  });

  // 1200 × 1200, one mullion from the sill to the top at x = 600.
  const panel: WindowPanelInput = {
    xMm: 0,
    yMm: 0,
    widthMm: 1200,
    heightMm: 1200,
    frameProfile: 'platform:frame',
    dividerProfile: null,
    dividers: [
      {
        id: 'd1',
        from: { on: 'sill', at: 600 },
        to: { on: 'top', at: 600 },
        sagMm: 0,
        profile: null,
        cut: {
          lengthMm: 0,
          fromLeftDeg: 0,
          fromRightDeg: 0,
          toLeftDeg: 0,
          toRightDeg: 0,
        },
      },
    ],
    sections: [section('a'), section('b')],
    isDoor: false,
    headShape: HeadShape.FLAT,
    headRiseMm: null,
  };

  it('builds a stored panel into frame, divider and two lights', () => {
    const input = panelLayoutInput(panel, {
      systemType: SystemType.HINGED,
      flyScreenAllowed: false,
    });
    const { outerMm, parts } = buildAssemblyLayout([input]);

    expect(outerMm).toEqual({ width: 1200, height: 1200 });
    expect(input.sections).toHaveLength(2);

    const frame = parts.find((p) => p.kind === 'frame');
    expect(frame?.rectMm).toMatchObject({ width: 1200, height: 1200 });

    const divider = parts.find((p) => p.kind === 'divider');
    expect(divider?.dividerAxis).toBe('v');
    // Sill to top inside the frame: 1200 − 2 × frame face.
    expect(divider?.cutLengthMm).toBeCloseTo(
      1200 - 2 * PLACEHOLDER_METRICS.frameFace,
      0,
    );

    expect(parts.filter((p) => p.kind === 'glass')).toHaveLength(2);
  });
});
