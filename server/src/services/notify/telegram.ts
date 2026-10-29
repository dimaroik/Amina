import { config } from '../../config.js';

export const telegramEnabled = () => Boolean(config.telegram.botToken);

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
  if (!telegramEnabled() || !config.telegram.webhookSecret || !config.publicUrl.startsWith('https://')) return;
  await api('setWebhook', {
    url: `${config.publicUrl}/api/webhooks/telegram/${config.telegram.webhookSecret}`,
    allowed_updates: ['message'],
  });
  console.log('[telegram] webhook configured');
}

export function telegramDeepLink(payload: string): string {
  if (!config.telegram.botUsername) return '';
  return `https://t.me/${config.telegram.botUsername.replace(/^@/, '')}?start=${payload}`;
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
