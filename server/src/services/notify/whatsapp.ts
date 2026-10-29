import { config } from '../../config.js';

export const whatsappEnabled = () =>
  Boolean(config.whatsapp.token && config.whatsapp.phoneNumberId && config.whatsapp.template);

export function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) digits = `38${digits}`;
  return digits;
}

/** Sends an approved WhatsApp Cloud API template with positional body parameters. */
export async function sendWhatsappTemplate(phone: string, params: string[]): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/v21.0/${config.whatsapp.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.whatsapp.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: normalizePhone(phone),
      type: 'template',
      template: {
        name: config.whatsapp.template,
        language: { code: config.whatsapp.templateLang },
        components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${await res.text()}`);
}
