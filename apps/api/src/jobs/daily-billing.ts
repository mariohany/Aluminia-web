// First: Sentry must load before Nest, as in main.ts.
import '../instrument';
import { NestFactory } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { AppModule } from '../app.module';
import { reportFatal } from '../common/monitoring';
import {
  describePending,
  findPendingMigrations,
  hasPending,
} from '../database/migration-check';
import { DailyBillingService } from '../modules/billing/daily-billing.service';

/**
 * The daily billing job (docs/payment_cycle_planing.md P17, P28;
 * docs/deploy_checklist.md): a DigitalOcean App Platform scheduled job runs
 * `npm run job:daily-billing --workspace=apps/api` once a day with the
 * API's environment. It boots the Nest application without HTTP, runs
 * `DailyBillingService.run()` and exits 0, or 1 when a step failed (the
 * next run tries again). Safe to run twice: the second run of a Cairo day
 * does nothing.
 */
async function main(): Promise<number> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  const logger = app.get(Logger);
  try {
    const pending = await findPendingMigrations(
      app.get<DataSource>(getDataSourceToken()),
    );
    if (hasPending(pending)) {
      const message = `Database is behind this build — daily billing not run. Pending migrations:\n  ${describePending(pending)}`;
      logger.fatal(message);
      await reportFatal(message);
      return 1;
    }
    const result = await app.get(DailyBillingService).run(new Date());
    logger.log(
      `Daily billing finished: ${JSON.stringify(result)}`,
      'DailyBilling',
    );
    return result.ran && result.failed.length > 0 ? 1 : 0;
  } catch (error) {
    logger.error(
      `Daily billing failed: ${(error as Error).stack ?? String(error)}`,
      'DailyBilling',
    );
    await reportFatal(`Daily billing failed: ${(error as Error).message}`);
    return 1;
  } finally {
    await app.close();
  }
}

void main().then((code) => process.exit(code));
