import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { one, query } from '../db/pool.js';
import { storeImage } from '../services/images.js';
import { fireAndForget } from '../services/notify/index.js';
import { escapeHtml, sendTelegram, telegramEnabled } from '../services/notify/telegram.js';
import { getSettings } from '../services/settings.js';
import { badRequest, notFound } from '../utils/errors.js';

export const reviewsRouter = Router();

const PAGE = 6;

export const REVIEW_SUMMARY_SQL = `
  SELECT COUNT(*) AS count, COALESCE(ROUND(AVG(rating)::numeric, 1), 0) AS avg,
    COUNT(*) FILTER (WHERE rating = 5) AS r5, COUNT(*) FILTER (WHERE rating = 4) AS r4,
    COUNT(*) FILTER (WHERE rating = 3) AS r3, COUNT(*) FILTER (WHERE rating = 2) AS r2,
    COUNT(*) FILTER (WHERE rating = 1) AS r1,
    COUNT(*) FILTER (WHERE fit = 'small') AS fit_small, COUNT(*) FILTER (WHERE fit = 'true') AS fit_true,
    COUNT(*) FILTER (WHERE fit = 'large') AS fit_large
  FROM reviews WHERE product_id = $1 AND status = 'approved'`;

reviewsRouter.get('/products/:slug/reviews', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const product = await one<{ id: number }>('SELECT id FROM products WHERE slug = $1 AND is_active', [req.params.slug]);
  if (!product) throw notFound('Товар не знайдено');
  const [s, items, photos] = await Promise.all([
    one(REVIEW_SUMMARY_SQL, [product.id]),
    query(
      `SELECT id, name, rating, text, size, height, fit, photos, verified, admin_reply, created_at
       FROM reviews WHERE product_id = $1 AND status = 'approved'
       ORDER BY (cardinality(photos) > 0) DESC, created_at DESC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`,
      [product.id],
    ),
    query(
      `SELECT r.id, p AS url FROM reviews r, unnest(r.photos) p
       WHERE r.product_id = $1 AND r.status = 'approved' ORDER BY r.created_at DESC LIMIT 24`,
      [product.id],
    ),
  ]);
  res.json({
    summary: {
      count: s.count,
      avg: Number(s.avg),
      distribution: { 5: s.r5, 4: s.r4, 3: s.r3, 2: s.r2, 1: s.r1 },
      fit: { small: s.fit_small, true: s.fit_true, large: s.fit_large },
    },
    items,
    photos,
    page,
    pages: Math.max(1, Math.ceil(s.count / PAGE)),
  });
});

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 4 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});
const photoLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });

reviewsRouter.post('/reviews/photos', photoLimiter, photoUpload.array('files', 4), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw badRequest('Оберіть фото');
  const stored = [];
  for (const f of files) {
    try {
      stored.push(await storeImage(f.buffer));
    } catch {
      throw badRequest('Не вдалося обробити фото — спробуйте інший файл');
    }
  }
  res.status(201).json(stored.map((s) => ({ url: s.url })));
});

const reviewLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 8, standardHeaders: true, legacyHeaders: false });

reviewsRouter.post('/products/:slug/reviews', reviewLimiter, async (req, res) => {
  const body = z
    .object({
      name: z.string().trim().min(2, 'Вкажіть ім’я').max(60),
      rating: z.number().int().min(1).max(5),
      text: z.string().trim().min(10, 'Напишіть хоча б кілька слів').max(2000),
      size: z.string().trim().max(20).default(''),
      height: z.number().int().min(100).max(220).nullable().default(null),
      fit: z.enum(['small', 'true', 'large']).nullable().default(null),
      // only photos uploaded through /reviews/photos are accepted
      photos: z.array(z.string().regex(/^\/api\/images\/[0-9a-f-]{36}$/)).max(4).default([]),
      orderNumber: z.string().trim().max(20).optional(),
      phone: z.string().trim().max(30).optional(),
    })
    .parse(req.body);
  const product = await one<{ id: number; name: string }>('SELECT id, name FROM products WHERE slug = $1 AND is_active', [req.params.slug]);
  if (!product) throw notFound('Товар не знайдено');

  // "Перевірена покупка": the order exists, the phone matches and it contains this product
  let verified = false;
  if (body.orderNumber && body.phone) {
    const digits = (s: string) => s.replace(/\D/g, '').slice(-9);
    const order = await one<{ id: number; customer_phone: string }>(
      `SELECT o.id, o.customer_phone FROM orders o
       WHERE upper(o.number) = upper($1) AND EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.product_id = $2)`,
      [body.orderNumber, product.id],
    );
    verified = Boolean(order && digits(body.phone).length === 9 && digits(order.customer_phone) === digits(body.phone));
  }

  const review = await one<{ id: number }>(
    `INSERT INTO reviews(product_id, name, rating, text, size, height, fit, photos, verified)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [product.id, body.name, body.rating, body.text, body.size, body.height, body.fit, body.photos, verified],
  );
  fireAndForget(notifyAdmins(product.name, body.name, body.rating, body.text, body.photos.length));
  res.status(201).json({ id: review!.id, verified });
});

async function notifyAdmins(product: string, name: string, rating: number, text: string, photos: number) {
  if (!telegramEnabled()) return;
  const s = await getSettings();
  const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
  const msg = `📝 <b>Новий відгук на модерацію</b>\n${escapeHtml(product)}\n${stars} — ${escapeHtml(name)}${photos ? ` · 📷 ${photos}` : ''}\n\n${escapeHtml(text.slice(0, 400))}`;
  const link = config.publicUrl.startsWith('https://') ? [{ text: 'Модерувати', url: `${config.publicUrl}/admin/reviews` }] : undefined;
  await Promise.allSettled(s.notifications.telegramAdminChatIds.map((id) => sendTelegram(id, msg, link)));
}
