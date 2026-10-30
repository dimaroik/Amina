import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { one, query } from '../db/pool.js';
import { emailEnabled } from '../services/notify/email.js';
import { telegramDeepLink } from '../services/notify/telegram.js';
import { badRequest } from '../utils/errors.js';

export const stockAlertsRouter = Router();

const limiter = rateLimit({ windowMs: 60 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

stockAlertsRouter.post('/stock-alerts', limiter, async (req, res) => {
  const body = z
    .object({ variantId: z.number().int(), email: z.union([z.string().trim().toLowerCase().email(), z.literal('')]).default('') })
    .parse(req.body);
  const variant = await one<{ id: number; stock: number }>(
    'SELECT v.id, v.stock FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1 AND p.is_active',
    [body.variantId],
  );
  if (!variant) throw badRequest('Товар не знайдено');
  if (variant.stock > 0) throw badRequest('Цей розмір уже є в наявності — можна замовляти');

  // One pending alert per email and variant; a Telegram-only request always gets a fresh token
  const existing = body.email
    ? await one<{ token: string }>('SELECT token FROM stock_alerts WHERE variant_id = $1 AND email = $2 AND notified_at IS NULL', [body.variantId, body.email])
    : null;
  const token = existing?.token ?? randomBytes(12).toString('hex');
  if (!existing) {
    await query('INSERT INTO stock_alerts(variant_id, email, token) VALUES ($1, $2, $3)', [body.variantId, body.email, token]);
  }
  res.status(201).json({
    ok: true,
    emailWorks: Boolean(body.email) && emailEnabled(),
    telegramLink: telegramDeepLink(`s_${token}`),
  });
});
