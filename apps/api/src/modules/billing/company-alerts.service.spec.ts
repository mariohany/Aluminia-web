import { UserRole } from '@repo/types/auth';
import type { DataSource } from 'typeorm';
import type { BillingRemindersService } from './billing-reminders.service';
import { CompanyAlertsService } from './company-alerts.service';

// Payment cycle P17: in production the daily job sends the reminders
// (BILLING_REMINDERS_BY_JOB); the alerts call then only shows the bar.
describe('CompanyAlertsService', () => {
  const endsAt = new Date(Date.now() + 4 * 86_400_000);
  const company = {
    id: 'c1',
    endsAt,
    isTrial: false,
    plan: { key: 'pro', nameEn: 'Pro', nameAr: 'احترافي' },
  };

  function make(byJob: boolean) {
    const reminders = {
      byJob,
      remindIfDue: jest.fn(() => Promise.resolve(true)),
    };
    const dataSource = {
      manager: { findOne: jest.fn(() => Promise.resolve(company)) },
    };
    const service = new CompanyAlertsService(
      dataSource as unknown as DataSource,
      reminders as unknown as BillingRemindersService,
    );
    return { service, reminders };
  }

  it('sends the due reminder on app open by default', async () => {
    const { service, reminders } = make(false);
    const alerts = await service.alerts({
      companyId: 'c1',
      role: UserRole.USER,
    });
    expect(alerts.ending).toMatchObject({ kind: 'ending', canRenew: false });
    expect(reminders.remindIfDue).toHaveBeenCalledTimes(1);
  });

  it('leaves the reminders to the daily job when it sends them', async () => {
    const { service, reminders } = make(true);
    const alerts = await service.alerts({
      companyId: 'c1',
      role: UserRole.COMPANY_ADMIN,
    });
    expect(alerts.ending).toMatchObject({ kind: 'ending', canRenew: true });
    expect(reminders.remindIfDue).not.toHaveBeenCalled();
  });
});
