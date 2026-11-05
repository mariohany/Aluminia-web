import { etaAddressOf } from '@repo/types/eta';
import {
  documentTotals,
  unusedCredit,
  upgradeHasCredit,
  upgradePeriod,
} from '@repo/types/billing-documents';

// docs/payment_cycle_planing.md P11, P15 (amended 2026-11-05): the rules
// the quotation dialog and the API share.
describe('documentTotals', () => {
  const base = {
    unitPrice: 6000,
    extraSeats: 0,
    extraSeatPrice: 0,
    discountKind: null,
    discountValue: null,
    vatRate: 14,
    fxRate: null,
  } as const;

  it('adds the extra seats before the discount (P15, P24)', () => {
    expect(
      documentTotals({
        ...base,
        extraSeats: 2,
        extraSeatPrice: 1000,
        discountKind: 'percent',
        discountValue: 10,
      }),
    ).toEqual({
      subtotal: 8000,
      extraSeatsAmount: 2000,
      discountAmount: 800,
      creditAmount: 0,
      vatAmount: 1008,
      total: 8208,
      totalEgp: 8208,
    });
  });

  it('takes the credit after the discount, never below zero', () => {
    const totals = documentTotals({ ...base, creditAmount: 1000 });
    expect(totals.creditAmount).toBe(1000);
    expect(totals.vatAmount).toBe(700);
    expect(totals.total).toBe(5700);
    expect(documentTotals({ ...base, creditAmount: 9999 }).total).toBe(0);
  });
});

describe('unusedCredit', () => {
  // Mario's example: Pro 3 months paid 16,200 (1 Oct - 31 Dec), on 4 Nov.
  const pro = {
    number: 'INV-2026-0043',
    startsOn: '2026-10-01',
    endsOn: '2026-12-31',
    valueEgp: 16200,
  };

  it('credits the unused days, today included, at what was paid', () => {
    expect(unusedCredit([pro], '2026-11-04', '2026-12-31')).toEqual([
      {
        invoiceNumber: 'INV-2026-0043',
        daysLeft: 58,
        days: 92,
        amountEgp: 10213.04,
      },
    ]);
  });

  it('skips periods that ended and counts a future period in full', () => {
    const renewal = {
      number: 'INV-2026-0050',
      startsOn: '2027-01-01',
      endsOn: '2027-03-31',
      valueEgp: 18000,
    };
    const old = {
      ...pro,
      number: 'INV-2026-0001',
      endsOn: '2026-09-30',
      startsOn: '2026-07-01',
    };
    const lines = unusedCredit([old, pro, renewal], '2026-11-04', '2027-03-31');
    expect(lines.map((l) => [l.invoiceNumber, l.daysLeft])).toEqual([
      ['INV-2026-0043', 58],
      ['INV-2026-0050', 90],
    ]);
    expect(lines[1].amountEgp).toBe(18000);
  });

  it('credits a day two invoices cover once, by the later (an earlier upgrade)', () => {
    const upgrade = {
      number: 'INV-2026-0044',
      startsOn: '2026-11-04',
      endsOn: '2026-12-31',
      valueEgp: 24965.22,
    };
    const lines = unusedCredit([pro, upgrade], '2026-12-01', '2026-12-31');
    expect(lines).toEqual([
      {
        invoiceNumber: 'INV-2026-0044',
        daysLeft: 31,
        days: 58,
        amountEgp: 13343.48,
      },
    ]);
  });

  it('counts no day after the current end (a period cut short by a move to Free)', () => {
    const ahead = {
      number: 'INV-2026-0050',
      startsOn: '2027-01-01',
      endsOn: '2027-03-31',
      valueEgp: 18000,
    };
    // Moved to Free, then paid again: the plan now ends on 15 Dec.
    const lines = unusedCredit([pro, ahead], '2026-11-04', '2026-12-15');
    expect(lines.map((l) => [l.invoiceNumber, l.daysLeft])).toEqual([
      ['INV-2026-0043', 42],
    ]);
  });
});

describe('upgradePeriod', () => {
  it('keeps the end when the new length fits inside it', () => {
    expect(upgradePeriod('2026-11-04', '2026-12-31', 1)).toEqual({
      startsOn: '2026-11-04',
      endsOn: '2026-12-31',
      full: false,
    });
  });

  it('starts today for the full length when it runs past the end', () => {
    expect(upgradePeriod('2026-11-04', '2026-12-31', 12)).toEqual({
      startsOn: '2026-11-04',
      endsOn: '2027-11-03',
      full: true,
    });
  });

  it('gives no credit for extra seats on the same plan and end (P15)', () => {
    expect(upgradeHasCredit(true, false)).toBe(false);
    expect(upgradeHasCredit(true, true)).toBe(true);
    expect(upgradeHasCredit(false, false)).toBe(true);
  });
});

describe('etaAddressOf', () => {
  it('is null until something is filled, then keeps every part', () => {
    expect(etaAddressOf({})).toBeNull();
    expect(etaAddressOf({ etaCountry: null, etaCity: null })).toBeNull();
    expect(etaAddressOf({ etaCountry: 'EG', etaCity: 'Nasr City' })).toEqual({
      country: 'EG',
      governorate: null,
      city: 'Nasr City',
      street: null,
      building: null,
    });
  });
});
