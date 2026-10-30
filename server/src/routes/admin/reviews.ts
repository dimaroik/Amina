import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../../db/pool.js';
import { notFound } from '../../utils/errors.js';

export const adminReviewsRouter = Router();

adminReviewsRouter.get('/reviews', async (req, res) => {
  const status = z.enum(['pending', 'approved', 'rejected']).default('pending').parse(req.query.status || undefined);
  const [items, counts] = await Promise.all([
    query(
      `SELECT r.*, p.name AS product_name, p.slug AS product_slug,
         (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) AS product_image
       FROM reviews r JOIN products p ON p.id = r.product_id
       WHERE r.status = $1 ORDER BY r.created_at DESC LIMIT 200`,
      [status],
    ),
    query('SELECT status, COUNT(*) AS count FROM reviews GROUP BY status'),
  ]);
  res.json({ items, counts: Object.fromEntries(counts.map((c) => [c.status, c.count])) });
});

adminReviewsRouter.patch('/reviews/:id', async (req, res) => {
  const body = z
    .object({
      status: z.enum(['pending', 'approved', 'rejected']).optional(),
      admin_reply: z.string().trim().max(2000).optional(),
    })
    .parse(req.body);
  const row = await one(
    `UPDATE reviews SET status = COALESCE($2, status), admin_reply = COALESCE($3, admin_reply) WHERE id = $1 RETURNING *`,
    [Number(req.params.id), body.status ?? null, body.admin_reply ?? null],
  );
  if (!row) throw notFound();
  res.json(row);
});

adminReviewsRouter.delete('/reviews/:id', async (req, res) => {
  await query('DELETE FROM reviews WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
});
