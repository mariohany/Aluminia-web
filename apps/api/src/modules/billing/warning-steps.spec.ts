import { dueWarningStep } from '@repo/types/alerts';

// B15: which warning email is due with N days to go (the smallest stage reached).
describe('dueWarningStep', () => {
  it.each([
    [45, null],
    [31, null],
    [30, 30],
    [16, 30],
    [15, 15],
    [6, 15],
    [5, 5],
    [2, 5],
    [1, 1],
    [0, 1],
  ])('%i days left → %s', (daysLeft, step) => {
    expect(dueWarningStep(daysLeft)).toBe(step);
  });
});
