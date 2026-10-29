/** One email (docs/subscriptions_planing.md §6a). */
export interface MailMessage {
  to: string[];
  /** Hidden copies (the sender's own "Send me a copy"). */
  bcc?: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: Array<{ name: string; contentBase64: string }>;
}

export interface Mailer {
  /** Resolves with the provider's message id; throws when it refused. */
  send(message: MailMessage): Promise<{ messageId: string | null }>;
}

export const MAILER = Symbol('MAILER');
