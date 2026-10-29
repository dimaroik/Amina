import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { one, query } from '../db/pool.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { publicOrder, getOrderFull } from '../services/orders.js';
import { HttpError } from '../utils/errors.js';

export const authRouter = Router();

const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

function session(user: { id: number; email: string; role: 'customer' | 'admin'; name: string; phone?: string }) {
  return {
    token: signToken({ id: user.id, email: user.email, role: user.role, name: user.name }),
    user: { id: user.id, email: user.email, role: user.role, name: user.name, phone: user.phone ?? '' },
  };
}

authRouter.post('/auth/register', limiter, async (req, res) => {
  const body = z
    .object({
      name: z.string().trim().min(2).max(120),
      email: z.string().trim().toLowerCase().email(),
      phone: z.string().trim().max(20).default(''),
      password: z.string().min(6, 'Пароль має містити щонайменше 6 символів').max(100),
    })
    .parse(req.body);
  const exists = await one('SELECT id FROM users WHERE email = $1', [body.email]);
  if (exists) throw new HttpError(409, 'Користувач з таким email вже існує');
  const hash = await bcrypt.hash(body.password, 10);
  const user = await one(
    'INSERT INTO users(email, password_hash, name, phone) VALUES ($1, $2, $3, $4) RETURNING id, email, role, name, phone',
    [body.email, hash, body.name, body.phone],
  );
  res.status(201).json(session(user));
});

authRouter.post('/auth/login', limiter, async (req, res) => {
  const body = z.object({ email: z.string().trim().toLowerCase(), password: z.string() }).parse(req.body);
  const user = await one('SELECT * FROM users WHERE email = $1', [body.email]);
  if (!user || !(await bcrypt.compare(body.password, user.password_hash))) {
    throw new HttpError(401, 'Невірний email або пароль');
  }
  res.json(session(user));
});

authRouter.get('/auth/me', requireAuth, async (req, res) => {
  const user = await one('SELECT id, email, role, name, phone FROM users WHERE id = $1', [req.user!.id]);
  if (!user) throw new HttpError(401, 'Сесія недійсна');
  res.json(user);
});

authRouter.put('/account/profile', requireAuth, async (req, res) => {
  const body = z
    .object({
      name: z.string().trim().min(2).max(120),
      phone: z.string().trim().max(20).default(''),
      password: z.string().min(6).max(100).optional(),
    })
    .parse(req.body);
  if (body.password) {
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user!.id, await bcrypt.hash(body.password, 10)]);
  }
  const user = await one('UPDATE users SET name = $2, phone = $3 WHERE id = $1 RETURNING id, email, role, name, phone', [
    req.user!.id,
    body.name,
    body.phone,
  ]);
  res.json(user);
});

authRouter.get('/account/orders', requireAuth, async (req, res) => {
  const rows = await query<{ id: number }>(
    'SELECT id FROM orders WHERE user_id = $1 OR (customer_email <> \'\' AND lower(customer_email) = lower($2)) ORDER BY created_at DESC LIMIT 100',
    [req.user!.id, req.user!.email],
  );
  const orders = await Promise.all(rows.map((r) => getOrderFull(r.id)));
  res.json(orders.filter(Boolean).map((o) => ({ ...publicOrder(o!), access_token: o!.access_token })));
});
