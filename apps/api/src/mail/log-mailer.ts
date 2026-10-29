import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Mailer, MailMessage } from './mailer';

/**
 * Sends nothing: logs who would get what. Used whenever there is no
 * BREVO_API_KEY, so laptops, CI and e2e never email anyone. Keeps the last
 * messages in memory for the e2e tests.
 */
export class LogMailer implements Mailer {
  private readonly logger = new Logger('LogMailer');
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<{ messageId: string | null }> {
    this.sent.push(message);
    if (this.sent.length > 200) this.sent.shift();
    this.logger.log(
      `Would email ${message.to.join(', ')}: "${message.subject}" (${message.attachments?.length ?? 0} attachments)`,
    );
    return Promise.resolve({ messageId: `log-${randomUUID()}` });
  }
}
