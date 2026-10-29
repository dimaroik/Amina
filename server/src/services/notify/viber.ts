import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../../config.js';

export const viberEnabled = () => Boolean(config.viber.token);

async function api(endpoint: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`https://chatapi.viber.com/pa/${endpoint}`, {
    method: 'POST',
    headers: { 'X-Viber-Auth-Token': config.viber.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json()) as { status: number; status_message: string };
  if (json.status !== 0) throw new Error(`Viber: ${json.status_message}`);
  return json;
}

export async function sendViber(userId: string, text: string): Promise<void> {
  await api('send_message', { receiver: userId, type: 'text', sender: { name: config.viber.botName }, text });
}

export async function setupViberWebhook(): Promise<void> {
  if (!viberEnabled() || !config.publicUrl.startsWith('https://')) return;
  await api('set_webhook', {
    url: `${config.publicUrl}/api/webhooks/viber`,
    event_types: ['conversation_started', 'subscribed', 'message'],
    send_name: true,
  });
  console.log('[viber] webhook configured');
}

export function verifyViberSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', config.viber.token).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function viberDeepLink(context: string): string {
  if (!config.viber.botUri) return '';
  return `viber://pa?chatURI=${encodeURIComponent(config.viber.botUri)}&context=${encodeURIComponent(context)}`;
}
