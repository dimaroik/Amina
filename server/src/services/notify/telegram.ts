import { createHash } from 'node:crypto';
import { config } from '../../config.js';

export const telegramEnabled = () => Boolean(config.telegram.botToken);

/**
 * URL-safe path segment for the webhook. Generated secrets (e.g. Render's generateValue) are base64
 * and may contain "/" or "+", which would break the route, so only a hex digest goes into the URL.
 */
export function telegramWebhookPath(): string {
  const source = config.telegram.webhookSecret || config.telegram.botToken;
  return createHash('sha256').update(source).digest('hex').slice(0, 40);
}

async function api(method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json()) as { ok: boolean; description?: string; result?: unknown };
  if (!json.ok) throw new Error(`Telegram: ${json.description}`);
  return json.result;
}

export async function sendTelegram(chatId: string, html: string, buttons?: { text: string; url: string }[]): Promise<void> {
  await api('sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: buttons?.length ? { inline_keyboard: [buttons.map((b) => ({ text: b.text, url: b.url }))] } : undefined,
  });
}

export async function setupTelegramWebhook(): Promise<void> {
  if (!telegramEnabled()) return;
  if (!config.publicUrl.startsWith('https://')) {
    console.warn(`[telegram] webhook not configured: public URL ${config.publicUrl} is not https`);
    return;
  }
  await api('setWebhook', {
    url: `${config.publicUrl}/api/webhooks/telegram/${telegramWebhookPath()}`,
    allowed_updates: ['message'],
  });
  console.log('[telegram] webhook configured');
}

export function telegramDeepLink(payload: string): string {
  if (!config.telegram.botUsername) return '';
  return `https://t.me/${config.telegram.botUsername.replace(/^@/, '')}?start=${payload}`;
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
