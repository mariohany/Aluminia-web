import {
  addDays,
  cairoDateOf,
  daysBetween,
  endOfCairoDay,
  subscriptionState,
  updateSubscriptionSchema,
} from '@repo/types/subscriptions';

// docs/subscriptions_planing.md B9, B11, B15: a subscription ends at
// 23:59:59 Cairo of its end date; the state is computed, never stored.
describe('Cairo end of day (B9)', () => {
  it('is 21:59:59 UTC in winter (UTC+2)', () => {
    expect(endOfCairoDay('2027-01-16').toISOString()).toBe(
      '2027-01-16T21:59:59.000Z',
    );
  });

  it('follows Egyptian summer time (UTC+3)', () => {
    expect(endOfCairoDay('2026-07-16').toISOString()).toBe(
      '2026-07-16T20:59:59.000Z',
    );
  });

  it('reads the Cairo calendar day, not the UTC one', () => {
    // 23:30 UTC on 15 Jan is already 16 Jan in Cairo.
    expect(cairoDateOf(new Date('2027-01-15T23:30:00Z'))).toBe('2027-01-16');
    expect(cairoDateOf(endOfCairoDay('2026-10-31'))).toBe('2026-10-31');
  });

  it('adds and counts whole days across months and years', () => {
    expect(addDays('2026-12-25', 14)).toBe('2027-01-08');
    expect(daysBetween('2026-12-25', '2027-01-08')).toBe(14);
    expect(daysBetween('2027-01-08', '2026-12-25')).toBe(-14);
  });
});

describe('subscriptionState', () => {
  const now = new Date('2026-10-28T10:00:00Z'); // 28 Oct, Cairo
  const ends = (date: string) => endOfCairoDay(date).toISOString();

  it('is free on Free, whatever the end date says', () => {
    expect(
      subscriptionState({ planKey: 'free', endsAt: null, isTrial: false }, now),
    ).toEqual({ kind: 'free' });
  });

  it('is active more than 30 days out', () => {
    expect(
      subscriptionState(
        { planKey: 'pro', endsAt: ends('2027-01-16'), isTrial: false },
        now,
      ),
    ).toEqual({ kind: 'active', endDate: '2027-01-16', daysLeft: 80 });
  });

  it('is ending, yellow, from 30 days to 6', () => {
    expect(
      subscriptionState(
        { planKey: 'pro', endsAt: ends('2026-11-27'), isTrial: false },
        now,
      ),
    ).toEqual({
      kind: 'ending',
      endDate: '2026-11-27',
      daysLeft: 30,
      tone: 'yellow',
    });
    expect(
      subscriptionState(
        { planKey: 'pro', endsAt: ends('2026-11-03'), isTrial: false },
        now,
      ),
    ).toMatchObject({ daysLeft: 6, tone: 'yellow' });
  });

  it('is red for the last 5 days, ending today included', () => {
    expect(
      subscriptionState(
        { planKey: 'pro', endsAt: ends('2026-11-02'), isTrial: false },
        now,
      ),
    ).toMatchObject({ kind: 'ending', daysLeft: 5, tone: 'red' });
    expect(
      subscriptionState(
        { planKey: 'pro', endsAt: ends('2026-10-28'), isTrial: false },
        now,
      ),
    ).toMatchObject({ kind: 'ending', daysLeft: 0, tone: 'red' });
  });

  it('expires one second after 23:59:59 Cairo', () => {
    const endsAt = endOfCairoDay('2026-10-27');
    const facts = { planKey: 'pro' as const, endsAt, isTrial: false };
    expect(subscriptionState(facts, endsAt).kind).toBe('ending');
    expect(subscriptionState(facts, new Date(endsAt.getTime() + 1000))).toEqual(
      { kind: 'expired', endDate: '2026-10-27' },
    );
  });

  // B11: a trial that ends unpaid drops to Free, never blocked.
  it('is a trial until its end, then free', () => {
    const facts = {
      planKey: 'pro' as const,
      endsAt: ends('2026-11-11'),
      isTrial: true,
    };
    expect(subscriptionState(facts, now)).toEqual({
      kind: 'trial',
      endDate: '2026-11-11',
      daysLeft: 14,
      tone: 'yellow',
    });
    expect(subscriptionState(facts, new Date('2026-11-12T00:00:00Z'))).toEqual({
      kind: 'free',
    });
  });
});

describe('updateSubscriptionSchema', () => {
  const base = {
    planKey: 'pro',
    maxUsers: 5,
    endDate: '2027-01-16',
    isTrial: false,
    currency: 'EGP',
    vatRate: 14,
    note: null,
    keepAdminId: null,
  };

  it('needs an end date on a paid plan, none on Free', () => {
    expect(updateSubscriptionSchema.safeParse(base).success).toBe(true);
    expect(
      updateSubscriptionSchema.safeParse({ ...base, endDate: null }).success,
    ).toBe(false);
    expect(
      updateSubscriptionSchema.safeParse({
        ...base,
        planKey: 'free',
        endDate: null,
      }).success,
    ).toBe(true);
  });

  it('refuses a trial on Free and a currency outside the list', () => {
    expect(
      updateSubscriptionSchema.safeParse({
        ...base,
        planKey: 'free',
        isTrial: true,
      }).success,
    ).toBe(false);
    expect(
      updateSubscriptionSchema.safeParse({ ...base, currency: 'GBP' }).success,
    ).toBe(false);
  });
});
