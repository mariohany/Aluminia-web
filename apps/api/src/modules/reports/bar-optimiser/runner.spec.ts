import { BarOptimiserRunner, SOLVE_TIMEOUT_ERROR } from './runner';
import { optimiseProject } from '@repo/bar-optimiser/project';

jest.mock('@repo/bar-optimiser/project', () => ({
  optimiseProject: jest.fn(),
}));

const settings = { lengths: [6000], kerfMm: 4, endTrimMm: 10 };

describe('BarOptimiserRunner (in-process, as under ts-jest)', () => {
  const optimise = jest.mocked(optimiseProject);

  it('fails with timeout when the solve runs past the cap', async () => {
    optimise.mockReturnValue(new Promise(() => undefined));
    await expect(
      new BarOptimiserRunner().run([], settings, () => undefined, 20),
    ).rejects.toThrow(SOLVE_TIMEOUT_ERROR);
  });

  it('returns the result when the solve beats the cap', async () => {
    const result = { profiles: [] } as unknown as Awaited<
      ReturnType<typeof optimiseProject>
    >;
    optimise.mockResolvedValue(result);
    await expect(
      new BarOptimiserRunner().run([], settings, () => undefined, 1_000),
    ).resolves.toBe(result);
  });
});
