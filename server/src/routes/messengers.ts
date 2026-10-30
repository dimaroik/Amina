import express, { Router } from 'express';
import { config } from '../config.js';
import { one, query } from '../db/pool.js';
import { orderStatusLabel, type OrderStatus } from '../services/labels.js';
import { addHistory } from '../services/orders.js';
import { escapeHtml, sendTelegram, telegramEnabled, telegramWebhookPath } from '../services/notify/telegram.js';
import { verifyViberSignature, viberEnabled } from '../services/notify/viber.js';
import { handleAdminCallback, handleAdminCommand } from '../services/admin-bot.js';

export const messengersRouter = Router();

messengersRouter.post('/webhooks/telegram/:secret', express.json(), async (req, res) => {
  res.json({ ok: true });
  if (!telegramEnabled() || req.params.secret !== telegramWebhookPath()) return;
  if (req.body?.callback_query) {
    await handleAdminCallback(req.body.callback_query).catch((err) => console.error('[telegram callback]', err));
    return;
  }
  const msg = req.body?.message;
  const chatId = msg?.chat?.id ? String(msg.chat.id) : '';
  const text: string = msg?.text ?? '';
  if (!chatId) return;
  try {
    const start = text.match(/^\/start\s+o_([a-f0-9]{32})/);
    if (start) {
      const order = await one('SELECT id, number, status FROM orders WHERE access_token = $1', [start[1]]);
      if (order) {
        await query('UPDATE orders SET telegram_chat_id = $2 WHERE id = $1', [order.id, chatId]);
        await addHistory(order.id, 'telegram_linked', 'Клієнт підписався на оновлення в Telegram');
        await sendTelegram(
          chatId,
          `Вітаємо! 🤍\nВи підписалися на оновлення замовлення <b>${escapeHtml(order.number)}</b>.\nПоточний статус: <b>${orderStatusLabel[order.status as OrderStatus]}</b>.\n\nМи повідомимо, щойно щось зміниться.`,
        );
        return;
      }
    }
    const alert = text.match(/^\/start\s+s_([a-f0-9]{24})/);
    if (alert) {
      const row = await one(
        `UPDATE stock_alerts a SET telegram_chat_id = $2 FROM product_variants v JOIN products p ON p.id = v.product_id
         WHERE a.token = $1 AND v.id = a.variant_id RETURNING p.name, v.size, v.color`,
        [alert[1], chatId],
      );
      if (row) {
        const variant = [row.color, row.size && `розмір ${row.size}`].filter(Boolean).join(', ');
        await sendTelegram(chatId, `Готово! 🤍 Ми напишемо вам тут, щойно <b>${escapeHtml(row.name)}</b>${variant ? ` (${escapeHtml(variant)})` : ''} з'явиться в наявності.`);
        return;
      }
    }
    if (await handleAdminCommand(chatId, text)) return;
    if (text.startsWith('/id')) {
      await sendTelegram(chatId, `Ваш chat ID: <code>${chatId}</code>\nДодайте його в адмінці → Налаштування → Сповіщення, щоб отримувати нові замовлення.`);
      return;
    }
    await sendTelegram(
      chatId,
      `Вітаємо в Amina! 🤍\nТут ви отримуватимете сповіщення про свої замовлення.\n\nКаталог: ${config.publicUrl}`,
    );
  } catch (err) {
    console.error('[telegram webhook]', err);
  }
});

// Viber signs the raw body, so this route needs it unparsed
messengersRouter.post('/webhooks/viber', express.raw({ type: '*/*' }), async (req, res) => {
  if (!viberEnabled()) return res.json({});
  const raw = req.body as Buffer;
  if (!verifyViberSignature(raw, req.header('X-Viber-Content-Signature'))) return res.status(403).json({});
  const event = JSON.parse(raw.toString('utf8'));
  try {
    const context: string = event.context ?? '';
    const userId: string = event.user?.id ?? event.sender?.id ?? '';
    const tokenMatch = context.match(/^o_([a-f0-9]{32})$/);
    if (userId && tokenMatch) {
      const order = await one('SELECT id, number FROM orders WHERE access_token = $1', [tokenMatch[1]]);
      if (order) {
        await query('UPDATE orders SET viber_user_id = $2 WHERE id = $1', [order.id, userId]);
        await addHistory(order.id, 'viber_linked', 'Клієнт підписався на оновлення у Viber');
        if (event.event === 'conversation_started') {
          return res.json({
            sender: { name: config.viber.botName },
            type: 'text',
            text: `Вітаємо! Надішліть будь-яке повідомлення, щоб отримувати оновлення замовлення ${order.number} 🤍`,
          });
        }
      }
    }
    if (event.event === 'message' && userId && /\/id/.test(event.message?.text ?? '')) {
      return res.json({ sender: { name: config.viber.botName }, type: 'text', text: `Ваш Viber ID: ${userId}` });
    }
  } catch (err) {
    console.error('[viber webhook]', err);
  }
  res.json({});
});
