import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { one, query, tx } from '../db/pool.js';
import { optionalAuth } from '../middleware/auth.js';
import { createInvoice, getInvoiceStatus, jarLink, monoAcquiringEnabled } from '../services/monobank.js';
import { fireAndForget, notifyOrderCreated, notifyOrderStatus } from '../services/notify/index.js';
import { telegramDeepLink } from '../services/notify/telegram.js';
import { viberDeepLink } from '../services/notify/viber.js';
import { novaPoshtaEnabled, searchCities, searchWarehouses } from '../services/novaposhta.js';
import { addHistory, getOrderFull, publicOrder, type OrderRow } from '../services/orders.js';
import { getSettings } from '../services/settings.js';
import { badRequest, HttpError, notFound } from '../utils/errors.js';

export const checkoutRouter = Router();

export async function applyPromo(code: string | undefined, subtotal: number) {
  if (!code) return { discount: 0, promo: null as null | { code: string; type: string; value: number } };
  const promo = await one(
    `SELECT * FROM promo_codes WHERE upper(code) = upper($1) AND is_active
       AND (expires_at IS NULL OR expires_at > now()) AND (max_uses IS NULL OR used_count < max_uses)`,
    [code.trim()],
  );
  if (!promo) throw badRequest('Промокод недійсний або термін його дії минув');
  if (subtotal < promo.min_total) throw badRequest(`Промокод діє на замовлення від ${promo.min_total} ₴`);
  const discount = promo.type === 'percent' ? Math.round((subtotal * promo.value) / 100) : Math.min(promo.value, subtotal);
  return { discount, promo: { code: promo.code, type: promo.type, value: promo.value } };
}

checkoutRouter.get('/checkout/config', async (_req, res) => {
  const [delivery, payments, settings] = await Promise.all([
    query('SELECT id, name, description, type, price, free_from FROM delivery_methods WHERE is_active ORDER BY sort_order, id'),
    query('SELECT id, code, name, description FROM payment_methods WHERE is_active ORDER BY sort_order, id'),
    getSettings(),
  ]);
  res.json({
    delivery,
    // Hide methods that are not configured yet so customers never pick a dead end
    payments: payments.filter(
      (p) =>
        (p.code !== 'mono_acquiring' || monoAcquiringEnabled()) &&
        (p.code !== 'mono_jar' || settings.payment.monoJarUrl) &&
        (p.code !== 'iban' || settings.payment.iban),
    ),
    novaPoshta: novaPoshtaEnabled(),
  });
});

checkoutRouter.post('/promo/validate', async (req, res) => {
  const { code, subtotal } = z.object({ code: z.string().min(1), subtotal: z.number().min(0) }).parse(req.body);
  res.json(await applyPromo(code, subtotal));
});

checkoutRouter.get('/np/cities', async (req, res) => {
  if (!novaPoshtaEnabled()) return res.json([]);
  try {
    res.json(await searchCities(String(req.query.q ?? '')));
  } catch (err) {
    console.error('[np]', err);
    res.json([]);
  }
});

checkoutRouter.get('/np/warehouses', async (req, res) => {
  if (!novaPoshtaEnabled() || !req.query.cityRef) return res.json([]);
  try {
    res.json(await searchWarehouses(String(req.query.cityRef), String(req.query.q ?? '')));
  } catch (err) {
    console.error('[np]', err);
    res.json([]);
  }
});

const orderSchema = z.object({
  customer: z.object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().regex(/^[+\d\s()-]{10,20}$/, 'Невірний номер телефону'),
    email: z.union([z.string().trim().toLowerCase().email(), z.literal('')]).default(''),
    contactChannel: z.enum(['phone', 'telegram', 'viber', 'whatsapp', 'email']).default('phone'),
  }),
  deliveryMethodId: z.number().int(),
  delivery: z
    .object({
      city: z.string().trim().max(200).default(''),
      cityRef: z.string().trim().max(100).default(''),
      branch: z.string().trim().max(300).default(''),
      branchRef: z.string().trim().max(60).default(''),
      address: z.string().trim().max(300).default(''),
    })
    .default({ city: '', cityRef: '', branch: '', branchRef: '', address: '' }),
  paymentMethod: z.enum(['cod', 'mono_jar', 'iban', 'mono_acquiring']),
  promoCode: z.string().trim().max(40).optional(),
  comment: z.string().trim().max(1000).default(''),
  items: z
    .array(z.object({ variantId: z.number().int(), quantity: z.number().int().min(1).max(99) }))
    .min(1, 'Кошик порожній')
    .max(50),
});

const orderLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });

checkoutRouter.post('/orders', orderLimiter, optionalAuth, async (req, res) => {
  const body = orderSchema.parse(req.body);
  const delivery = await one('SELECT * FROM delivery_methods WHERE id = $1 AND is_active', [body.deliveryMethodId]);
  if (!delivery) throw badRequest('Оберіть спосіб доставки');
  const payment = await one('SELECT * FROM payment_methods WHERE code = $1 AND is_active', [body.paymentMethod]);
  if (!payment) throw badRequest('Оберіть спосіб оплати');
  if (body.paymentMethod === 'mono_acquiring' && !monoAcquiringEnabled()) throw badRequest('Онлайн-оплата тимчасово недоступна');
  if (delivery.type !== 'pickup' && !body.delivery.city) throw badRequest('Вкажіть місто доставки');
  if (delivery.type === 'np_warehouse' && !body.delivery.branch) throw badRequest('Оберіть відділення Нової пошти');
  if ((delivery.type === 'address' || delivery.type === 'np_courier') && !body.delivery.address) throw badRequest('Вкажіть адресу доставки');

  const orderId = await tx(async (client) => {
    // Merge duplicate lines, lock variants, verify stock
    const qty = new Map<number, number>();
    body.items.forEach((i) => qty.set(i.variantId, (qty.get(i.variantId) ?? 0) + i.quantity));
    const { rows: variants } = await client.query(
      `SELECT v.id, v.size, v.color, v.sku AS vsku, v.stock, COALESCE(v.price, p.price) AS price,
         p.id AS product_id, p.name, p.sku, p.is_active,
         (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image
       FROM product_variants v JOIN products p ON p.id = v.product_id
       WHERE v.id = ANY($1) FOR UPDATE OF v`,
      [[...qty.keys()]],
    );
    if (variants.length !== qty.size) throw badRequest('Деякі товари більше недоступні. Оновіть кошик.');
    for (const v of variants) {
      const want = qty.get(v.id)!;
      if (!v.is_active) throw badRequest(`Товар «${v.name}» більше недоступний`);
      if (v.stock < want) {
        throw new HttpError(409, `«${v.name}»${v.size ? ` (${v.size})` : ''}: в наявності лише ${v.stock} шт.`, {
          variantId: v.id,
          stock: v.stock,
        });
      }
    }
    const subtotal = variants.reduce((s, v) => s + Number(v.price) * qty.get(v.id)!, 0);
    const { discount, promo } = await applyPromo(body.promoCode, subtotal);
    const afterDiscount = subtotal - discount;
    const deliveryCost = delivery.free_from !== null && afterDiscount >= delivery.free_from ? 0 : Number(delivery.price);
    const total = afterDiscount + deliveryCost;

    const { rows: [seq] } = await client.query("SELECT nextval('order_number_seq') AS n");
    const number = `AM-${seq.n}`;
    const accessToken = randomBytes(16).toString('hex');
    const initialPaymentStatus = body.paymentMethod === 'cod' ? 'pending' : 'awaiting';

    const { rows: [order] } = await client.query(
      `INSERT INTO orders (number, access_token, user_id, payment_status, customer_name, customer_phone, customer_email, contact_channel,
         delivery_method_id, delivery_name, delivery_type, delivery_city, delivery_city_ref, delivery_branch, delivery_address, delivery_cost,
         payment_method, payment_name, subtotal, discount, total, promo_code, comment, delivery_branch_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING id`,
      [
        number, accessToken, req.user?.id ?? null, initialPaymentStatus,
        body.customer.name, body.customer.phone, body.customer.email, body.customer.contactChannel,
        delivery.id, delivery.name, delivery.type, body.delivery.city, body.delivery.cityRef, body.delivery.branch, body.delivery.address, deliveryCost,
        payment.code, payment.name, subtotal, discount, total, promo?.code ?? null, body.comment,
        delivery.type === 'np_warehouse' ? body.delivery.branchRef : '',
      ],
    );
    for (const v of variants) {
      const q = qty.get(v.id)!;
      await client.query(
        `INSERT INTO order_items (order_id, product_id, variant_id, name, sku, size, color, image_url, price, quantity)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [order.id, v.product_id, v.id, v.name, v.vsku || v.sku, v.size, v.color, v.image, v.price, q],
      );
      await client.query('UPDATE product_variants SET stock = stock - $2 WHERE id = $1', [v.id, q]);
      await client.query('UPDATE products SET sales_count = sales_count + $2 WHERE id = $1', [v.product_id, q]);
    }
    if (promo) await client.query('UPDATE promo_codes SET used_count = used_count + 1 WHERE upper(code) = upper($1)', [promo.code]);
    await client.query("INSERT INTO order_history(order_id, action, note) VALUES ($1, 'created', 'Замовлення створено на сайті')", [order.id]);
    return order.id as number;
  });

  let order = (await getOrderFull(orderId))!;
  if (order.payment_method === 'mono_acquiring') {
    try {
      const invoice = await createInvoice({
        amount: order.total,
        reference: order.number,
        destination: `Оплата замовлення ${order.number}`,
        redirectUrl: `${config.publicUrl}/order/${order.number}?token=${order.access_token}`,
        webHookUrl: `${config.publicUrl}/api/webhooks/monobank`,
      });
      await query('UPDATE orders SET payment_invoice_id = $2, payment_url = $3 WHERE id = $1', [orderId, invoice.invoiceId, invoice.pageUrl]);
      order = (await getOrderFull(orderId))!;
    } catch (err) {
      console.error('[monobank]', err);
      await addHistory(orderId, 'payment_error', 'Не вдалося створити рахунок Monobank');
    }
  }

  fireAndForget(notifyOrderCreated(orderId));
  res.status(201).json(await orderResponse(order));
});

async function orderResponse(order: OrderRow) {
  const settings = await getSettings();
  const purpose = settings.payment.paymentPurpose.replace('{number}', order.number);
  return {
    order: publicOrder(order),
    accessToken: order.access_token,
    payment: {
      method: order.payment_method,
      jarUrl: order.payment_method === 'mono_jar' ? jarLink(settings.payment.monoJarUrl, order.total, purpose) : '',
      iban:
        order.payment_method === 'iban'
          ? { iban: settings.payment.iban, recipient: settings.payment.recipient, edrpou: settings.payment.edrpou, bank: settings.payment.bankName, purpose }
          : null,
      payUrl: order.payment_url ?? '',
    },
    links: {
      telegram: telegramDeepLink(`o_${order.access_token}`),
      viber: viberDeepLink(`o_${order.access_token}`),
    },
  };
}

/** Order status page: by secret token (from email / success page) or number + phone. */
checkoutRouter.get('/orders/:number', async (req, res) => {
  const { token, phone } = z.object({ token: z.string().optional(), phone: z.string().optional() }).parse(req.query);
  const row = await one<{ id: number; access_token: string; customer_phone: string }>(
    'SELECT id, access_token, customer_phone FROM orders WHERE upper(number) = upper($1)',
    [req.params.number],
  );
  const digits = (s: string) => s.replace(/\D/g, '').slice(-9);
  const ok = row && ((token && token === row.access_token) || (phone && digits(phone).length === 9 && digits(phone) === digits(row.customer_phone)));
  if (!row || !ok) throw notFound('Замовлення не знайдено. Перевірте номер і телефон.');
  const order = (await getOrderFull(row.id))!;
  res.json(await orderResponse(order));
});

checkoutRouter.post('/webhooks/monobank', async (req, res) => {
  const invoiceId = String(req.body?.invoiceId ?? '');
  res.json({ ok: true });
  if (!invoiceId || !monoAcquiringEnabled()) return;
  try {
    const order = await one('SELECT id, payment_status FROM orders WHERE payment_invoice_id = $1', [invoiceId]);
    if (!order) return;
    const status = await getInvoiceStatus(invoiceId);
    const map: Record<string, string> = { success: 'paid', failure: 'failed', expired: 'failed', reversed: 'refunded' };
    const next = map[status.status];
    if (next && next !== order.payment_status) {
      await query('UPDATE orders SET payment_status = $2, updated_at = now() WHERE id = $1', [order.id, next]);
      await addHistory(order.id, 'payment', `Monobank: ${status.status}`);
      if (next === 'paid' || next === 'refunded') fireAndForget(notifyOrderStatus(order.id, { paymentChanged: true }));
    }
  } catch (err) {
    console.error('[monobank webhook]', err);
  }
});
