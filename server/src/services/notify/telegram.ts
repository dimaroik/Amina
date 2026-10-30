import { createHash } from 'node:crypto';
import { config } from '../../config.js';

export const telegramEnabled = () => Boolean(config.telegram.botToken);

// overridable only to test against a local stub
const API_BASE = process.env.TELEGRAM_API_URL || 'https://api.telegram.org';

/**
 * URL-safe path segment for the webhook. Generated secrets (e.g. Render's generateValue) are base64
 * and may contain "/" or "+", which would break the route, so only a hex digest goes into the URL.
 */
export function telegramWebhookPath(): string {
  const source = config.telegram.webhookSecret || config.telegram.botToken;
  return createHash('sha256').update(source).digest('hex').slice(0, 40);
}

export type TgButton = { text: string; url: string } | { text: string; callback_data: string };
export type TgKeyboard = TgButton[][];

export async function api(method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${API_BASE}/bot${config.telegram.botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  const json = (await res.json()) as { ok: boolean; description?: string; result?: unknown };
  if (!json.ok) throw new Error(`Telegram: ${json.description}`);
  return json.result;
}

export async function sendTelegram(chatId: string, html: string, buttons?: { text: string; url: string }[] | TgKeyboard): Promise<{ message_id: number }> {
  const keyboard = buttons?.length ? (Array.isArray(buttons[0]) ? (buttons as TgKeyboard) : [buttons as TgButton[]]) : undefined;
  return api('sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });
}

/** Replaces the text and buttons of a message the bot sent earlier. */
export async function editTelegram(chatId: string | number, messageId: number, html: string, keyboard?: TgKeyboard): Promise<void> {
  try {
    await api('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: keyboard ?? [] },
    });
  } catch (err) {
    // pressing a button that does not change anything is not an error for us
    if (!String(err).includes('message is not modified')) throw err;
  }
}

export async function answerCallback(id: string, text = '', alert = false): Promise<void> {
  await api('answerCallbackQuery', { callback_query_id: id, text, show_alert: alert }).catch(() => undefined);
}

/** Multipart upload (photo or document) — works even when the site URL is not reachable by Telegram. */
async function upload(method: 'sendPhoto' | 'sendDocument', field: 'photo' | 'document', chatId: string, file: { data: Buffer; name: string; type: string }, fields: Record<string, unknown>) {
  const form = new FormData();
  form.append('chat_id', chatId);
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  form.append(field, new Blob([new Uint8Array(file.data)], { type: file.type }), file.name);
  const res = await fetch(`${API_BASE}/bot${config.telegram.botToken}/${method}`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
  const json = (await res.json()) as { ok: boolean; description?: string; result?: { message_id: number } };
  if (!json.ok) throw new Error(`Telegram: ${json.description}`);
  return json.result!;
}

/** An album of 2–10 photos; the caption goes under the first one (albums can't carry buttons). */
export async function sendTelegramAlbum(chatId: string, photos: Buffer[], captionHtml: string): Promise<{ message_id: number }> {
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append(
    'media',
    JSON.stringify(photos.map((_, i) => ({ type: 'photo', media: `attach://p${i}`, ...(i === 0 ? { caption: captionHtml, parse_mode: 'HTML' } : {}) }))),
  );
  photos.forEach((p, i) => form.append(`p${i}`, new Blob([new Uint8Array(p)], { type: 'image/jpeg' }), `p${i}.jpg`));
  const res = await fetch(`${API_BASE}/bot${config.telegram.botToken}/sendMediaGroup`, { method: 'POST', body: form, signal: AbortSignal.timeout(90_000) });
  const json = (await res.json()) as { ok: boolean; description?: string; result?: { message_id: number }[] | { message_id: number } };
  if (!json.ok) throw new Error(`Telegram: ${json.description}`);
  // the Bot API returns one message per photo; the first one carries the caption
  return Array.isArray(json.result) ? json.result[0]! : json.result!;
}

export function sendTelegramPhoto(chatId: string, photo: Buffer, captionHtml: string, keyboard?: TgKeyboard) {
  return upload('sendPhoto', 'photo', chatId, { data: photo, name: 'photo.jpg', type: 'image/jpeg' }, {
    caption: captionHtml,
    parse_mode: 'HTML',
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });
}

export function sendTelegramDocument(chatId: string, data: Buffer, name: string, captionHtml = '') {
  return upload('sendDocument', 'document', chatId, { data, name, type: 'application/pdf' }, { caption: captionHtml || undefined, parse_mode: 'HTML' });
}

export async function setupTelegramWebhook(): Promise<void> {
  if (!telegramEnabled()) return;
  if (!config.publicUrl.startsWith('https://')) {
    console.warn(`[telegram] webhook not configured: public URL ${config.publicUrl} is not https`);
    return;
  }
  await api('setWebhook', {
    url: `${config.publicUrl}/api/webhooks/telegram/${telegramWebhookPath()}`,
    allowed_updates: ['message', 'callback_query'],
  });
  console.log('[telegram] webhook configured');
}

/** Telegram's view of the webhook (pending updates, last delivery error) — shown in the admin panel. */
export async function telegramWebhookInfo(): Promise<{ url: string; pending_update_count: number; last_error_message?: string; last_error_date?: number }> {
  return api('getWebhookInfo', {});
}

export function telegramDeepLink(payload: string): string {
  if (!config.telegram.botUsername) return '';
  return `https://t.me/${config.telegram.botUsername.replace(/^@/, '')}?start=${payload}`;
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
