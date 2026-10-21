import { LookupSlice, staleLookupSlices } from '@repo/types/lookups';

// docs/lookup_caching_planing.md §6.2 — which cached slices a version
// check sends back to the server.
describe('staleLookupSlices', () => {
  const glass = { glass: 3, glass_combination: 5 };

  it('keeps a slice whose versions are unchanged', () => {
    expect(staleLookupSlices({ glass }, glass)).toEqual([]);
  });

  it('refetches a slice when any member entity moved up', () => {
    expect(
      staleLookupSlices({ glass }, { glass: 3, glass_combination: 6 }),
    ).toEqual([LookupSlice.GLASS]);
  });

  it('keeps a slice newer than the answer (own write), so it never loops', () => {
    expect(
      staleLookupSlices({ glass }, { glass: 2, glass_combination: 5 }),
    ).toEqual([]);
  });

  it('only looks at slices it holds, and at their own entities', () => {
    expect(
      staleLookupSlices(
        { glass, colors: { color: 1, paint_brand: 1, painting_price: 1 } },
        {
          ...glass,
          color: 1,
          paint_brand: 1,
          painting_price: 1,
          system_brand: 9,
        },
      ),
    ).toEqual([]);
  });

  it('treats a member missing from the cached slice as stale', () => {
    expect(staleLookupSlices({ glass: { glass: 3 } }, glass)).toEqual([
      LookupSlice.GLASS,
    ]);
  });
});
