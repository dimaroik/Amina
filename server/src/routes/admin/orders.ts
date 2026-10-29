import { Router } from 'express';
import { z } from 'zod';
import { one, query, tx } from '../../db/pool.js';
import { ORDER_STATUSES, PAYMENT_STATUSES, orderStatusLabel, paymentStatusLabel } from '../../services/labels.js';
import { fireAndForget, notifyOrderStatus } from '../../services/notify/index.js';
import { addHistory, getOrderFull } from '../../services/orders.js';
import { badRequest, notFound } from '../../utils/errors.js';

export const adminOrdersRouter = Router();

const listSchema = z.object({
  status: z.string().optional(),
  payment_status: z.string().optional(),
  q: z.string().trim().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

function buildFilter(p: z.infer<typeof listSchema>) {
  const where: string[] = ['TRUE'];
  const values: unknown[] = [];
  const add = (v: unknown) => (values.push(v), `$${values.length}`);
  if (p.status) where.push(`o.status = ANY(${add(p.status.split(','))})`);
  if (p.payment_status) where.push(`o.payment_status = ANY(${add(p.payment_status.split(','))})`);
  if (p.q) {
    const t = add(`%${p.q}%`);
    where.push(`(o.number ILIKE ${t} OR o.customer_name ILIKE ${t} OR o.customer_phone ILIKE ${t} OR o.customer_email ILIKE ${t} OR o.tracking_number ILIKE ${t})`);
  }
  if (p.from) where.push(`o.created_at >= ${add(p.from)}::date`);
  if (p.to) where.push(`o.created_at < (${add(p.to)}::date + 1)`);
  return { sql: where.join(' AND '), values };
}

adminOrdersRouter.get('/orders', async (req, res) => {
  const p = listSchema.parse(req.query);
  const { sql, values } = buildFilter(p);
  const [items, count, counts] = await Promise.all([
    query(
      `SELECT o.id, o.number, o.status, o.payment_status, o.customer_name, o.customer_phone, o.customer_email,
         o.delivery_name, o.delivery_city, o.payment_name, o.total, o.created_at, o.tracking_number, o.admin_note,
         (SELECT COALESCE(SUM(quantity), 0) FROM order_items WHERE order_id = o.id) AS items_count,
         (SELECT image_url FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 1) AS preview
       FROM orders o WHERE ${sql} ORDER BY o.created_at DESC LIMIT ${p.limit} OFFSET ${(p.page - 1) * p.limit}`,
      values,
    ),
    one(`SELECT COUNT(*) AS total FROM orders o WHERE ${sql}`, values),
    query('SELECT status, COUNT(*) AS count FROM orders GROUP BY status'),
  ]);
  res.json({
    items,
    total: count.total,
    page: p.page,
    pages: Math.max(1, Math.ceil(count.total / p.limit)),
    statusCounts: Object.fromEntries(counts.map((c) => [c.status, c.count])),
  });
});

adminOrdersRouter.get('/orders/export.csv', async (req, res) => {
  const p = listSchema.parse({ ...req.query, limit: 200 });
  const { sql, values } = buildFilter(p);
  const rows = await query(
    `SELECT o.*, (SELECT string_agg(name || ' ' || size || ' x' || quantity, '; ') FROM order_items WHERE order_id = o.id) AS items
     FROM orders o WHERE ${sql} ORDER BY o.created_at DESC LIMIT 5000`,
    values,
  );
  const cols: [string, (r: any) => unknown][] = [
    ['Номер', (r) => r.number],
    ['Дата', (r) => new Date(r.created_at).toLocaleString('uk-UA')],
    ['Статус', (r) => orderStatusLabel[r.status as keyof typeof orderStatusLabel]],
    ['Оплата', (r) => paymentStatusLabel[r.payment_status as keyof typeof paymentStatusLabel]],
    ['Клієнт', (r) => r.customer_name],
    ['Телефон', (r) => r.customer_phone],
    ['Email', (r) => r.customer_email],
    ['Доставка', (r) => [r.delivery_name, r.delivery_city, r.delivery_branch, r.delivery_address].filter(Boolean).join(', ')],
    ['ТТН', (r) => r.tracking_number],
    ['Спосіб оплати', (r) => r.payment_name],
    ['Товари', (r) => r.items],
    ['Сума', (r) => r.total],
    ['Коментар', (r) => r.comment],
  ];
  const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.map((c) => escape(c[0])).join(','), ...rows.map((r) => cols.map((c) => escape(c[1](r))).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`﻿${csv}`);
});

adminOrdersRouter.get('/orders/:id', async (req, res) => {
  const order = await getOrderFull(Number(req.params.id));
  if (!order) throw notFound('Замовлення не знайдено');
  const [history, notifications, customerOrders] = await Promise.all([
    query('SELECT * FROM order_history WHERE order_id = $1 ORDER BY created_at DESC, id DESC', [order.id]),
    query('SELECT * FROM notification_log WHERE order_id = $1 ORDER BY created_at DESC', [order.id]),
    one(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total) FILTER (WHERE status NOT IN ('cancelled','returned')), 0) AS spent
       FROM orders WHERE right(regexp_replace(customer_phone, '\\D', '', 'g'), 9) = right(regexp_replace($1, '\\D', '', 'g'), 9)`,
      [order.customer_phone],
    ),
  ]);
  res.json({ ...order, history, notifications, customerStats: customerOrders });
});

const patchSchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  payment_status: z.enum(PAYMENT_STATUSES).optional(),
  tracking_number: z.string().trim().max(60).optional(),
  admin_note: z.string().max(5000).optional(),
  customer_name: z.string().trim().min(1).max(120).optional(),
  customer_phone: z.string().trim().min(5).max(30).optional(),
  customer_email: z.string().trim().max(200).optional(),
  delivery_city: z.string().trim().max(200).optional(),
  delivery_branch: z.string().trim().max(300).optional(),
  delivery_address: z.string().trim().max(300).optional(),
  delivery_cost: z.number().min(0).optional(),
  discount: z.number().min(0).optional(),
  comment: z.string().max(1000).optional(),
  notify: z.boolean().default(true),
  note: z.string().max(1000).default(''),
});

/** Returns stock when an order moves into a cancelled/returned state, and takes it back when restored. */
async function syncStock(client: import('pg').PoolClient, orderId: number, from: string, to: string) {
  const released = (s: string) => s === 'cancelled' || s === 'returned';
  if (released(from) === released(to)) return;
  const sign = released(to) ? 1 : -1;
  await client.query(
    `UPDATE product_variants v SET stock = GREATEST(0, v.stock + $2 * oi.quantity)
     FROM order_items oi WHERE oi.order_id = $1 AND oi.variant_id = v.id`,
    [orderId, sign],
  );
}

adminOrdersRouter.patch('/orders/:id', async (req, res) => {
  const id = Number(req.params.id);
  const body = patchSchema.parse(req.body);
  const before = await one('SELECT * FROM orders WHERE id = $1', [id]);
  if (!before) throw notFound('Замовлення не знайдено');
  const author = req.user!.name || req.user!.email;

  const fields = [
    'status', 'payment_status', 'tracking_number', 'admin_note', 'customer_name', 'customer_phone', 'customer_email',
    'delivery_city', 'delivery_branch', 'delivery_address', 'delivery_cost', 'discount', 'comment',
  ] as const;
  const sets: string[] = [];
  const values: unknown[] = [id];
  for (const f of fields) {
    if (body[f] !== undefined && body[f] !== before[f]) {
      values.push(body[f]);
      sets.push(`${f} = $${values.length}`);
    }
  }
  if (sets.length) {
    await tx(async (client) => {
      await client.query(`UPDATE orders SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, values);
      if (body.delivery_cost !== undefined || body.discount !== undefined) {
        await client.query('UPDATE orders SET total = GREATEST(0, subtotal - discount + delivery_cost) WHERE id = $1', [id]);
      }
      if (body.status && body.status !== before.status) await syncStock(client, id, before.status, body.status);
    });
  }

  const statusChanged = Boolean(body.status && body.status !== before.status);
  const paymentChanged = Boolean(body.payment_status && body.payment_status !== before.payment_status);
  if (statusChanged) await addHistory(id, 'status', `${orderStatusLabel[before.status as keyof typeof orderStatusLabel]} → ${orderStatusLabel[body.status!]}${body.note ? `. ${body.note}` : ''}`, author);
  if (paymentChanged) await addHistory(id, 'payment', `${paymentStatusLabel[before.payment_status as keyof typeof paymentStatusLabel]} → ${paymentStatusLabel[body.payment_status!]}`, author);
  if (body.tracking_number !== undefined && body.tracking_number !== before.tracking_number) await addHistory(id, 'tracking', `ТТН: ${body.tracking_number || '—'}`, author);
  const otherChanged = sets.length && !statusChanged && !paymentChanged && body.tracking_number === undefined;
  if (otherChanged) await addHistory(id, 'edit', 'Дані замовлення оновлено', author);

  if (body.notify && (statusChanged || paymentChanged)) fireAndForget(notifyOrderStatus(id, { statusChanged, paymentChanged }));
  res.json(await getOrderFull(id));
});

adminOrdersRouter.put('/orders/:id/items', async (req, res) => {
  const id = Number(req.params.id);
  const body = z
    .object({
      items: z
        .array(
          z.object({
            id: z.number().int().optional(),
            variant_id: z.number().int().nullable().optional(),
            name: z.string().trim().min(1).optional(),
            price: z.number().min(0).optional(),
            quantity: z.number().int().min(1).max(999),
          }),
        )
        .min(1),
    })
    .parse(req.body);
  const author = req.user!.name || req.user!.email;
  await tx(async (client) => {
    const { rows: [order] } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
    if (!order) throw notFound('Замовлення не знайдено');
    const holdsStock = !['cancelled', 'returned'].includes(order.status);
    const { rows: current } = await client.query('SELECT * FROM order_items WHERE order_id = $1', [id]);
    const keep = new Set(body.items.filter((i) => i.id).map((i) => i.id));
    for (const old of current) {
      if (!keep.has(old.id)) {
        await client.query('DELETE FROM order_items WHERE id = $1', [old.id]);
        if (holdsStock && old.variant_id) await client.query('UPDATE product_variants SET stock = stock + $2 WHERE id = $1', [old.variant_id, old.quantity]);
      }
    }
    for (const item of body.items) {
      if (item.id) {
        const old = current.find((c) => c.id === item.id);
        if (!old) throw badRequest('Позицію не знайдено');
        await client.query('UPDATE order_items SET quantity = $2, price = COALESCE($3, price) WHERE id = $1', [item.id, item.quantity, item.price ?? null]);
        if (holdsStock && old.variant_id && old.quantity !== item.quantity) {
          await client.query('UPDATE product_variants SET stock = GREATEST(0, stock - $2) WHERE id = $1', [old.variant_id, item.quantity - old.quantity]);
        }
      } else if (item.variant_id) {
        const { rows: [v] } = await client.query(
          `SELECT v.*, p.name, p.sku AS psku, COALESCE(v.price, p.price) AS final_price, p.id AS pid,
             (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image
           FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`,
          [item.variant_id],
        );
        if (!v) throw badRequest('Варіант товару не знайдено');
        await client.query(
          `INSERT INTO order_items (order_id, product_id, variant_id, name, sku, size, color, image_url, price, quantity)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [id, v.pid, v.id, v.name, v.sku || v.psku, v.size, v.color, v.image, item.price ?? v.final_price, item.quantity],
        );
        if (holdsStock) await client.query('UPDATE product_variants SET stock = GREATEST(0, stock - $2) WHERE id = $1', [v.id, item.quantity]);
      }
    }
    await client.query(
      `UPDATE orders SET subtotal = s.sum, total = GREATEST(0, s.sum - discount + delivery_cost), updated_at = now()
       FROM (SELECT COALESCE(SUM(price * quantity), 0) AS sum FROM order_items WHERE order_id = $1) s WHERE id = $1`,
      [id],
    );
    await client.query("INSERT INTO order_history(order_id, action, note, author) VALUES ($1, 'items', 'Склад замовлення змінено', $2)", [id, author]);
  });
  res.json(await getOrderFull(id));
});

adminOrdersRouter.post('/orders/:id/notify', async (req, res) => {
  const id = Number(req.params.id);
  const { message } = z.object({ message: z.string().trim().min(1).max(2000) }).parse(req.body);
  await notifyOrderStatus(id, { customMessage: message });
  await addHistory(id, 'message', `Повідомлення клієнту: ${message}`, req.user!.name || req.user!.email);
  res.json({ ok: true });
});

adminOrdersRouter.delete('/orders/:id', async (req, res) => {
  const id = Number(req.params.id);
  await tx(async (client) => {
    const { rows: [order] } = await client.query('SELECT status FROM orders WHERE id = $1', [id]);
    if (!order) throw notFound('Замовлення не знайдено');
    if (!['cancelled', 'returned'].includes(order.status)) await syncStock(client, id, order.status, 'cancelled');
    await client.query('DELETE FROM orders WHERE id = $1', [id]);
  });
  res.json({ ok: true });
});
