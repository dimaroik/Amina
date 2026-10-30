import { config } from '../config.js';
import { query } from '../db/pool.js';
import { money } from './labels.js';
import { emailEnabled, sendEmail } from './notify/email.js';
import { escapeHtml, sendTelegram, telegramEnabled } from './notify/telegram.js';
import { getSettings } from './settings.js';

let running: Promise<void> | null = null;

/**
 * Notifies everyone waiting for a variant that is back in stock.
 * Safe to call after any stock change; concurrent calls share one run.
 */
export function processStockAlerts(): Promise<void> {
  running ??= run().finally(() => {
    running = null;
  });
  return running;
}

async function run(): Promise<void> {
  const due = await query(
    `SELECT a.id, a.email, a.telegram_chat_id, v.size, v.color, COALESCE(v.price, p.price) AS price, p.name, p.slug,
       (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image
     FROM stock_alerts a
     JOIN product_variants v ON v.id = a.variant_id
     JOIN products p ON p.id = v.product_id
     WHERE a.notified_at IS NULL AND v.stock > 0 AND p.is_active
       AND (a.email <> '' OR a.telegram_chat_id IS NOT NULL)
     LIMIT 200`,
  );
  if (!due.length) return;
  const s = await getSettings();
  for (const a of due) {
    const url = `${config.publicUrl}/product/${a.slug}`;
    const variant = [a.color, a.size && `розмір ${a.size}`].filter(Boolean).join(', ');
    let sent = false;
    let failed = false;
    if (a.telegram_chat_id && telegramEnabled()) {
      try {
        await sendTelegram(
          a.telegram_chat_id,
          `🤍 <b>${escapeHtml(a.name)}</b>${variant ? ` (${escapeHtml(variant)})` : ''} знову в наявності!\nЦіна: ${money(a.price)}\n\nПоспішайте — кількість обмежена.`,
          config.publicUrl.startsWith('https://') ? [{ text: 'Купити', url }] : undefined,
        );
        sent = true;
      } catch (err) {
        failed = true;
        console.error('[stock-alerts] telegram', err instanceof Error ? err.message : err);
      }
    }
    if (a.email && emailEnabled()) {
      try {
        const img = a.image ? `<img src="${a.image.startsWith('http') ? a.image : config.publicUrl + a.image}" width="200" style="display:block;margin:0 auto 16px">` : '';
        await sendEmail(
          a.email,
          `${a.name} знову в наявності — ${s.store.name}`,
          `<div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;text-align:center;color:#1f1d1a">
            <div style="font-family:Georgia,serif;font-size:26px;letter-spacing:.3em;margin-bottom:24px">${escapeHtml(s.store.name.toUpperCase())}</div>
            ${img}<h2 style="font-family:Georgia,serif;font-weight:400">${escapeHtml(a.name)} знову в наявності</h2>
            <p>${escapeHtml(variant)} · ${money(a.price)}</p>
            <p><a href="${url}" style="display:inline-block;background:#1f1d1a;color:#fff;padding:12px 24px;text-decoration:none;letter-spacing:.08em;font-size:13px">КУПИТИ</a></p>
          </div>`,
        );
        sent = true;
      } catch (err) {
        failed = true;
        console.error('[stock-alerts] email', err instanceof Error ? err.message : err);
      }
    }
    // A failed send stays pending and is retried on the next stock change; once one channel
    // delivered (or none is configured at all) the alert is closed so nobody is messaged twice
    if (sent || !failed) await query('UPDATE stock_alerts SET notified_at = now() WHERE id = $1', [a.id]);
    if (!sent && !failed) console.warn(`[stock-alerts] alert ${a.id} had no configured channel`);
  }
}
