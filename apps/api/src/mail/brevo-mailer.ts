import type { Mailer, MailMessage } from './mailer';

/** Brevo's transactional email API (free plan: 300 a day). */
export class BrevoMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: { email: string; name: string },
  ) {}

  async send(message: MailMessage): Promise<{ messageId: string | null }> {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': this.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: this.from,
        to: message.to.map((email) => ({ email })),
        ...(message.bcc?.length
          ? { bcc: message.bcc.map((email) => ({ email })) }
          : {}),
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
        ...(message.attachments?.length
          ? {
              attachment: message.attachments.map((a) => ({
                name: a.name,
                content: a.contentBase64,
              })),
            }
          : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      messageId?: string;
      message?: string;
    };
    if (!res.ok) {
      throw new Error(
        `Brevo answered ${res.status}: ${body.message ?? 'no message'}`,
      );
    }
    return { messageId: body.messageId ?? null };
  }
}
