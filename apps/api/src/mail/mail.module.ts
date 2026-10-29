import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { BrevoMailer } from './brevo-mailer';
import { LogMailer } from './log-mailer';
import { MAILER } from './mailer';

/** The Mailer (docs/subscriptions_planing.md §6a), globally: Brevo with a
 * key and a sender, else the log mailer. */
@Global()
@Module({
  providers: [
    {
      provide: MAILER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const key = config.get('BREVO_API_KEY', { infer: true });
        const from = config.get('MAIL_FROM', { infer: true });
        const logger = new Logger('MailModule');
        if (key && from) {
          logger.log(`Mail: Brevo, from ${from}`);
          return new BrevoMailer(key, {
            email: from,
            name: config.get('MAIL_FROM_NAME', { infer: true }),
          });
        }
        logger.log('Mail: log only (no BREVO_API_KEY / MAIL_FROM)');
        return new LogMailer();
      },
    },
  ],
  exports: [MAILER],
})
export class MailModule {}
