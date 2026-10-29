import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../../config.js';

export const emailEnabled = () => Boolean(config.mail.resendApiKey || config.mail.smtpHost);

let transport: Transporter | null = null;

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (config.mail.resendApiKey) {
    // Resend HTTP API — works on hosts that block outbound SMTP (e.g. Render free tier)
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.mail.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.mail.from, to: [to], subject, html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
    return;
  }
  if (config.mail.smtpHost) {
    transport ??= nodemailer.createTransport({
      host: config.mail.smtpHost,
      port: config.mail.smtpPort,
      secure: config.mail.smtpPort === 465,
      auth: config.mail.smtpUser ? { user: config.mail.smtpUser, pass: config.mail.smtpPass } : undefined,
    });
    await transport.sendMail({ from: config.mail.from, to, subject, html });
    return;
  }
  throw new Error('Email не налаштовано (RESEND_API_KEY або SMTP_HOST)');
}
