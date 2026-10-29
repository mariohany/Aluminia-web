import { arabicDays, reminderEmail } from './templates';

// The warning email's Arabic day count agrees with its number ("3 يومًا" was wrong).
describe('arabicDays', () => {
  it.each([
    [1, 'يوم واحد'],
    [2, 'يومين'],
    [3, '3 أيام'],
    [10, '10 أيام'],
    [11, '11 يومًا'],
    [30, '30 يومًا'],
  ])('%i → %s', (n, text) => {
    expect(arabicDays(n)).toBe(text);
  });

  it('is what the warning subject says', () => {
    const mail = reminderEmail({
      companyEn: 'Gulf Facades',
      companyAr: null,
      planEn: 'Pro',
      planAr: 'احترافي',
      endsOn: '2026-11-01',
      daysLeft: 3,
      appUrl: 'https://aluminia.test',
    });
    expect(mail.subject).toBe(
      'Your Aluminia subscription ends in 3 days · اشتراكك ينتهي خلال 3 أيام',
    );
  });
});
