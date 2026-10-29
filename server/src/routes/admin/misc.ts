import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z, type ZodObject, type ZodRawShape } from 'zod';
import { config } from '../../config.js';
import { one, query } from '../../db/pool.js';
import { emailEnabled } from '../../services/notify/email.js';
import { telegramEnabled } from '../../services/notify/telegram.js';
import { viberEnabled } from '../../services/notify/viber.js';
import { whatsappEnabled } from '../../services/notify/whatsapp.js';
import { monoAcquiringEnabled } from '../../services/monobank.js';
import { novaPoshtaEnabled } from '../../services/novaposhta.js';
import { getSettings, updateSettings } from '../../services/settings.js';
import { sendEmail } from '../../services/notify/email.js';
import { sendTelegram } from '../../services/notify/telegram.js';
import { badRequest, notFound } from '../../utils/errors.js';

export const adminMiscRouter = Router();

/** Simple CRUD for small reference tables managed from the admin panel. */
function crud<S extends ZodRawShape>(path: string, table: string, schema: ZodObject<S>, orderBy = 'sort_order, id') {
  const cols = Object.keys(schema.shape);
  adminMiscRouter.get(`/${path}`, async (_req, res) => {
    res.json(await query(`SELECT * FROM ${table} ORDER BY ${orderBy}`));
  });
  adminMiscRouter.post(`/${path}`, async (req, res) => {
    const b = schema.parse(req.body) as Record<string, unknown>;
    const row = await one(
      `INSERT INTO ${table}(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
      cols.map((c) => b[c]),
    );
    res.status(201).json(row);
  });
  adminMiscRouter.put(`/${path}/:id`, async (req, res) => {
    const b = schema.parse(req.body) as Record<string, unknown>;
    const row = await one(
      `UPDATE ${table} SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
      [Number(req.params.id), ...cols.map((c) => b[c])],
    );
    if (!row) throw notFound();
    res.json(row);
  });
  adminMiscRouter.delete(`/${path}/:id`, async (req, res) => {
    await query(`DELETE FROM ${table} WHERE id = $1`, [Number(req.params.id)]);
    res.json({ ok: true });
  });
}

crud(
  'delivery-methods',
  'delivery_methods',
  z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(1000).default(''),
    type: z.enum(['np_warehouse', 'np_courier', 'address', 'pickup']),
    price: z.number().min(0).default(0),
    free_from: z.number().min(0).nullable().default(null),
    is_active: z.boolean().default(true),
    sort_order: z.number().int().default(0),
  }),
);

crud(
  'payment-methods',
  'payment_methods',
  z.object({
    code: z.enum(['cod', 'mono_jar', 'iban', 'mono_acquiring']),
    name: z.string().trim().min(1).max(120),
    description: z.string().max(1000).default(''),
    is_active: z.boolean().default(true),
    sort_order: z.number().int().default(0),
  }),
);

crud(
  'promo-codes',
  'promo_codes',
  z.object({
    code: z.string().trim().toUpperCase().min(2).max(40),
    type: z.enum(['percent', 'fixed']),
    value: z.number().min(0),
    min_total: z.number().min(0).default(0),
    max_uses: z.number().int().min(1).nullable().default(null),
    expires_at: z.string().nullable().default(null),
    is_active: z.boolean().default(true),
  }),
  'created_at DESC',
);

crud(
  'banners',
  'banners',
  z.object({
    title: z.string().max(200).default(''),
    subtitle: z.string().max(400).default(''),
    image_url: z.string().min(1).max(500),
    link: z.string().max(500).default(''),
    button_text: z.string().max(60).default(''),
    sort_order: z.number().int().default(0),
    is_active: z.boolean().default(true),
  }),
);

crud(
  'faq',
  'faq_items',
  z.object({
    question: z.string().trim().min(1).max(500),
    answer: z.string().trim().min(1).max(5000),
    sort_order: z.number().int().default(0),
    is_active: z.boolean().default(true),
  }),
);

// ---------- dashboard ----------
adminMiscRouter.get('/dashboard', async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days ?? 30)));
  const counted = "status NOT IN ('cancelled', 'returned')";
  const [totals, prev, daily, byStatus, top, recent, lowStock, chats] = await Promise.all([
    one(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(total) FILTER (WHERE ${counted}), 0) AS revenue,
         COALESCE(AVG(total) FILTER (WHERE ${counted}), 0) AS avg_check,
         COUNT(DISTINCT right(regexp_replace(customer_phone, '\\D', '', 'g'), 9)) AS customers
       FROM orders WHERE created_at >= now() - ($1 || ' days')::interval`,
      [days],
    ),
    one(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(total) FILTER (WHERE ${counted}), 0) AS revenue FROM orders
       WHERE created_at >= now() - ($1 * 2 || ' days')::interval AND created_at < now() - ($1 || ' days')::interval`,
      [days],
    ),
    query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS date, COALESCE(COUNT(o.id), 0) AS orders, COALESCE(SUM(o.total) FILTER (WHERE o.${counted}), 0) AS revenue
       FROM generate_series(current_date - ($1::int - 1), current_date, '1 day') d
       LEFT JOIN orders o ON o.created_at::date = d::date
       GROUP BY d ORDER BY d`,
      [days],
    ),
    query('SELECT status, COUNT(*) AS count FROM orders GROUP BY status'),
    query(
      `SELECT oi.name, oi.product_id, SUM(oi.quantity) AS qty, SUM(oi.quantity * oi.price) AS revenue, MAX(oi.image_url) AS image
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.created_at >= now() - ($1 || ' days')::interval AND o.${counted}
       GROUP BY oi.name, oi.product_id ORDER BY qty DESC LIMIT 6`,
      [days],
    ),
    query('SELECT id, number, customer_name, total, status, payment_status, created_at FROM orders ORDER BY created_at DESC LIMIT 8'),
    query(
      `SELECT p.id, p.name, v.size, v.color, v.stock FROM product_variants v JOIN products p ON p.id = v.product_id
       WHERE p.is_active AND v.stock <= 2 ORDER BY v.stock, p.name LIMIT 10`,
    ),
    one("SELECT COUNT(*) FILTER (WHERE needs_human) AS waiting, COUNT(*) FILTER (WHERE updated_at > now() - interval '1 day') AS today FROM chat_sessions"),
  ]);
  res.json({ days, totals, prev, daily, byStatus, top, recent, lowStock, chats });
});

// ---------- customers ----------
adminMiscRouter.get('/customers', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const rows = await query(
    `SELECT right(regexp_replace(customer_phone, '\\D', '', 'g'), 9) AS key,
       (array_agg(customer_name ORDER BY created_at DESC))[1] AS name,
       (array_agg(customer_phone ORDER BY created_at DESC))[1] AS phone,
       (array_agg(customer_email ORDER BY created_at DESC) FILTER (WHERE customer_email <> ''))[1] AS email,
       COUNT(*) AS orders,
       COALESCE(SUM(total) FILTER (WHERE status NOT IN ('cancelled','returned')), 0) AS spent,
       MAX(created_at) AS last_order,
       BOOL_OR(user_id IS NOT NULL) AS registered
     FROM orders
     WHERE $1 = '' OR customer_name ILIKE '%' || $1 || '%' OR customer_phone ILIKE '%' || $1 || '%' OR customer_email ILIKE '%' || $1 || '%'
     GROUP BY 1 ORDER BY last_order DESC LIMIT 500`,
    [q],
  );
  res.json(rows);
});

adminMiscRouter.get('/subscribers', async (_req, res) => {
  res.json(await query('SELECT * FROM subscribers ORDER BY created_at DESC'));
});

// ---------- chats ----------
adminMiscRouter.get('/chats', async (_req, res) => {
  res.json(
    await query(
      `SELECT id, needs_human, contact, created_at, updated_at, jsonb_array_length(transcript) AS messages,
         transcript -> 0 ->> 'text' AS first_message
       FROM chat_sessions WHERE jsonb_array_length(transcript) > 0 ORDER BY needs_human DESC, updated_at DESC LIMIT 200`,
    ),
  );
});

adminMiscRouter.get('/chats/:id', async (req, res) => {
  const row = await one('SELECT id, needs_human, contact, transcript, created_at, updated_at FROM chat_sessions WHERE id = $1', [req.params.id]);
  if (!row) throw notFound();
  res.json(row);
});

adminMiscRouter.patch('/chats/:id', async (req, res) => {
  const { needs_human } = z.object({ needs_human: z.boolean() }).parse(req.body);
  await query('UPDATE chat_sessions SET needs_human = $2 WHERE id = $1', [req.params.id, needs_human]);
  res.json({ ok: true });
});

// ---------- settings ----------
adminMiscRouter.get('/settings', async (_req, res) => {
  res.json({
    settings: await getSettings(),
    integrations: {
      email: emailEnabled(),
      telegram: telegramEnabled(),
      telegramBot: config.telegram.botUsername,
      viber: viberEnabled(),
      whatsapp: whatsappEnabled(),
      monobankAcquiring: monoAcquiringEnabled(),
      novaPoshta: novaPoshtaEnabled(),
      chatbotAi: config.anthropic.enabled,
      publicUrl: config.publicUrl,
    },
  });
});

adminMiscRouter.put('/settings', async (req, res) => {
  const body = z
    .object({
      store: z.record(z.string(), z.any()).optional(),
      payment: z.record(z.string(), z.any()).optional(),
      notifications: z.record(z.string(), z.any()).optional(),
      chatbot: z.record(z.string(), z.any()).optional(),
    })
    .parse(req.body);
  res.json(await updateSettings(body as any));
});

adminMiscRouter.post('/settings/test-notification', async (req, res) => {
  const { channel } = z.object({ channel: z.enum(['email', 'telegram']) }).parse(req.body);
  const s = await getSettings();
  const results: { to: string; ok: boolean; error?: string }[] = [];
  const targets = channel === 'email' ? s.notifications.adminEmails : s.notifications.telegramAdminChatIds;
  if (!targets.length) throw badRequest('Спершу додайте отримувачів у налаштуваннях');
  for (const to of targets) {
    try {
      if (channel === 'email') await sendEmail(to, 'Тестове сповіщення Amina', '<p>Сповіщення налаштовано правильно ✅</p>');
      else await sendTelegram(to, 'Сповіщення налаштовано правильно ✅');
      results.push({ to, ok: true });
    } catch (err) {
      results.push({ to, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  res.json(results);
});

// ---------- admins ----------
adminMiscRouter.get('/admins', async (_req, res) => {
  res.json(await query("SELECT id, email, name, created_at FROM users WHERE role = 'admin' ORDER BY id"));
});

adminMiscRouter.post('/admins', async (req, res) => {
  const b = z
    .object({ email: z.string().trim().toLowerCase().email(), name: z.string().trim().min(1), password: z.string().min(8) })
    .parse(req.body);
  const hash = await bcrypt.hash(b.password, 10);
  const row = await one(
    `INSERT INTO users(email, password_hash, name, role) VALUES ($1,$2,$3,'admin')
     ON CONFLICT (email) DO UPDATE SET role = 'admin', password_hash = EXCLUDED.password_hash, name = EXCLUDED.name
     RETURNING id, email, name, created_at`,
    [b.email, hash, b.name],
  );
  res.status(201).json(row);
});

adminMiscRouter.delete('/admins/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) throw badRequest('Не можна видалити власний обліковий запис');
  const count = await one<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
  if ((count?.n ?? 0) <= 1) throw badRequest('Має залишитися хоча б один адміністратор');
  await query("UPDATE users SET role = 'customer' WHERE id = $1", [id]);
  res.json({ ok: true });
});
