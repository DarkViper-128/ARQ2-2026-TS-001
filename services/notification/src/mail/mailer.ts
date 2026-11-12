import { Injectable } from '@nestjs/common';
import { createTransport } from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

/**
 * Email delivery over SMTP. In development the target is Mailpit (nothing leaves the
 * machine); in production the same code points at the provider's SMTP relay (spec.md names
 * SendGrid), so only `SMTP_*` changes.
 */
@Injectable()
export class Mailer {
  private readonly from = process.env.MAIL_FROM ?? 'FlashTix <no-reply@flashtix.test>';
  private readonly transport = createTransport({
    host: process.env.SMTP_HOST ?? 'mailpit',
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: false,
    ...(process.env.SMTP_USER
      ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? '' } }
      : {}),
    connectionTimeout: 5000,
    socketTimeout: 15000,
  });

  async send(mail: Mail): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...mail });
  }
}
