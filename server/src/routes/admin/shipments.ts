import { Router } from 'express';
import { z } from 'zod';
import { one, query, tx } from '../../db/pool.js';
import { loadShipment, nbuRate, computeShipment, preorderOrders, type ShipmentItemRow, type ShipmentRow } from '../../services/shipments.js';
import { processStockAlerts } from '../../services/stock-alerts.js';
import { fireAndForget, notifyOrderStatus } from '../../services/notify/index.js';
import { addHistory } from '../../services/orders.js';
import { badRequest, HttpError, notFound } from '../../utils/errors.js';
import { productSchema, saveProduct } from './catalog.js';

export const adminShipmentsRouter = Router();

const headerSchema = z.object({
  title: z.string().trim().min(1).max(120),
  supplier: z.string().trim().max(200).default(''),
  currency: z.enum(['USD', 'CNY', 'EUR', 'UAH']).default('USD'),
  exchange_rate: z.number().positive().max(1000),
  extra_cost: z.number().min(0).default(0),
  allocation: z.enum(['value', 'quantity']).default('value'),
  tracking: z.string().trim().max(100).default(''),
  note: z.string().max(2000).default(''),
  ordered_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expected_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  preorder_enabled: z.boolean().default(false),
  show_incoming: z.boolean().default(false),
});

/**
 * Products created for a shipment are shown while it is announced on the site ("on the way"
 * or open for pre-order) and hidden again when it is not, unless something is in stock.
 */
async function syncPreorderVisibility(id: number) {
  await query(
    `UPDATE products p SET is_active = (s.preorder_enabled OR s.show_incoming), updated_at = now()
     FROM shipments s
     WHERE s.id = $1 AND s.status = 'in_transit' AND p.is_active <> (s.preorder_enabled OR s.show_incoming)
       AND p.id IN (SELECT product_id FROM shipment_items WHERE shipment_id = $1 AND activate_on_receive AND product_id IS NOT NULL)
       AND (s.preorder_enabled OR s.show_incoming OR NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.stock > 0))`,
    [id],
  );
}

async function editable(id: number): Promise<ShipmentRow> {
  const s = await one<ShipmentRow>('SELECT * FROM shipments WHERE id = $1', [id]);
  if (!s) throw notFound('Поставку не знайдено');
  if (s.status === 'received') throw badRequest('Поставку вже оприбутковано — зміни складу неможливі');
  return s;
}

adminShipmentsRouter.get('/fx', async (req, res) => {
  const currency = z.enum(['USD', 'CNY', 'EUR', 'UAH']).parse(req.query.currency);
  try {
    res.json(await nbuRate(currency));
  } catch {
    throw new HttpError(502, 'Не вдалося отримати курс НБУ — введіть вручну');
  }
});

adminShipmentsRouter.get('/shipments', async (_req, res) => {
  const shipments = await query<ShipmentRow>('SELECT * FROM shipments ORDER BY created_at DESC LIMIT 200');
  const items = await query<ShipmentItemRow>(
    `SELECT si.*, COALESCE(v.price, p.price) AS sale_price,
       (SELECT url FROM product_images WHERE product_id = si.product_id ORDER BY sort_order, id LIMIT 1) AS image
     FROM shipment_items si LEFT JOIN product_variants v ON v.id = si.variant_id LEFT JOIN products p ON p.id = si.product_id
     WHERE si.shipment_id = ANY($1)`,
    [shipments.map((s) => s.id)],
  );
  res.json(
    shipments.map((s) => {
      const own = items.filter((i) => i.shipment_id === s.id);
      return { ...s, totals: computeShipment(s, own).totals, previews: [...new Set(own.map((i) => i.image).filter(Boolean))].slice(0, 4) };
    }),
  );
});

adminShipmentsRouter.get('/shipments/:id', async (req, res) => {
  const s = await loadShipment(Number(req.params.id));
  if (!s) throw notFound('Поставку не знайдено');
  res.json(s);
});

adminShipmentsRouter.post('/shipments', async (req, res) => {
  const b = headerSchema.parse(req.body);
  const row = await one<{ id: number }>(
    `INSERT INTO shipments(title, supplier, currency, exchange_rate, extra_cost, allocation, tracking, note, ordered_at, expected_at, preorder_enabled, show_incoming)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::date, current_date),$10,$11,$12) RETURNING id`,
    [b.title, b.supplier, b.currency, b.exchange_rate, b.extra_cost, b.allocation, b.tracking, b.note, b.ordered_at ?? null, b.expected_at, b.preorder_enabled, b.show_incoming],
  );
  res.status(201).json(await loadShipment(row!.id));
});

adminShipmentsRouter.put('/shipments/:id', async (req, res) => {
  const id = Number(req.params.id);
  const b = headerSchema.parse(req.body);
  const s = await one<ShipmentRow>('SELECT * FROM shipments WHERE id = $1', [id]);
  if (!s) throw notFound('Поставку не знайдено');
  // after receiving only the descriptive fields can change; the cost basis is frozen
  if (s.status === 'received') {
    await query('UPDATE shipments SET title=$2, supplier=$3, tracking=$4, note=$5 WHERE id=$1', [id, b.title, b.supplier, b.tracking, b.note]);
  } else {
    await query(
      `UPDATE shipments SET title=$2, supplier=$3, currency=$4, exchange_rate=$5, extra_cost=$6, allocation=$7, tracking=$8, note=$9,
         ordered_at=COALESCE($10::date, ordered_at), expected_at=$11, preorder_enabled=$12, show_incoming=$13 WHERE id=$1`,
      [id, b.title, b.supplier, b.currency, b.exchange_rate, b.extra_cost, b.allocation, b.tracking, b.note, b.ordered_at ?? null, b.expected_at, b.preorder_enabled, b.show_incoming],
    );
    await syncPreorderVisibility(id);
  }
  res.json(await loadShipment(id));
});

adminShipmentsRouter.delete('/shipments/:id', async (req, res) => {
  const id = Number(req.params.id);
  await editable(id);
  const waiting = await preorderOrders(id);
  if (waiting.length) {
    throw badRequest(`З цієї поставки вже є передзамовлення (${waiting.map((o) => o.number).join(', ')}). Скасуйте їх або оприбуткуйте поставку.`);
  }
  await tx(async (client) => {
    // products created only for this shipment and never shown are removed with it
    await client.query(
      `DELETE FROM products p USING shipment_items si
       WHERE si.shipment_id = $1 AND si.activate_on_receive AND si.product_id = p.id AND NOT p.is_active
         AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = p.id)`,
      [id],
    );
    await client.query('DELETE FROM shipments WHERE id = $1', [id]);
  });
  res.json({ ok: true });
});

// ---------- items ----------

async function preorderedFor(shipmentId: number, itemId: number): Promise<number> {
  const row = await one<{ n: number }>(
    `SELECT COALESCE(SUM(oi.quantity), 0)::int AS n FROM shipment_items si
     JOIN order_items oi ON oi.preorder_shipment_id = si.shipment_id AND oi.variant_id = si.variant_id
     JOIN orders o ON o.id = oi.order_id AND o.status NOT IN ('cancelled', 'returned')
     WHERE si.id = $2 AND si.shipment_id = $1`,
    [shipmentId, itemId],
  );
  return row?.n ?? 0;
}

adminShipmentsRouter.post('/shipments/:id/items', async (req, res) => {
  const id = Number(req.params.id);
  await editable(id);
  const b = z.object({ variant_id: z.number().int(), quantity: z.number().int().min(1).max(10000), unit_price: z.number().min(0).default(0) }).parse(req.body);
  const v = await one(
    'SELECT v.id, v.size, v.color, p.id AS product_id, p.name FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1',
    [b.variant_id],
  );
  if (!v) throw badRequest('Варіант товару не знайдено');
  const existing = await one<{ id: number }>('SELECT id FROM shipment_items WHERE shipment_id = $1 AND variant_id = $2', [id, b.variant_id]);
  if (existing) {
    await query('UPDATE shipment_items SET quantity = quantity + $2, unit_price = $3 WHERE id = $1', [existing.id, b.quantity, b.unit_price]);
  } else {
    await query(
      'INSERT INTO shipment_items(shipment_id, product_id, variant_id, name, size, color, quantity, unit_price) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, v.product_id, v.id, v.name, v.size, v.color, b.quantity, b.unit_price],
    );
  }
  res.status(201).json(await loadShipment(id));
});

/** Creates a new (hidden) product with its variants and adds every variant to the shipment. */
adminShipmentsRouter.post('/shipments/:id/products', async (req, res) => {
  const id = Number(req.params.id);
  const b = z
    .object({
      product: productSchema.omit({ variants: true, is_active: true }),
      unit_price: z.number().min(0).default(0),
      lines: z
        .array(z.object({ size: z.string().trim().max(30).default(''), color: z.string().trim().max(60).default(''), color_hex: z.string().max(20).nullable().default(null), quantity: z.number().int().min(1).max(10000) }))
        .min(1, 'Додайте хоча б один розмір / колір'),
    })
    .parse(req.body);
  const shipment = await editable(id);
  const productId = await saveProduct(null, {
    ...b.product,
    // visible straight away when the shipment is announced on the site
    is_active: shipment.preorder_enabled || shipment.show_incoming,
    variants: b.lines.map((l) => ({ size: l.size, color: l.color, color_hex: l.color_hex, sku: '', stock: 0, price: null })),
  });
  const variants = await query<{ id: number; size: string; color: string }>(
    'SELECT id, size, color FROM product_variants WHERE product_id = $1 ORDER BY sort_order, id',
    [productId],
  );
  for (const [i, l] of b.lines.entries()) {
    const v = variants[i]!;
    await query(
      `INSERT INTO shipment_items(shipment_id, product_id, variant_id, name, size, color, quantity, unit_price, activate_on_receive)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
      [id, productId, v.id, b.product.name, v.size, v.color, l.quantity, b.unit_price],
    );
  }
  res.status(201).json(await loadShipment(id));
});

adminShipmentsRouter.patch('/shipments/:id/items/:itemId', async (req, res) => {
  const id = Number(req.params.id);
  await editable(id);
  const b = z.object({ quantity: z.number().int().min(1).max(10000).optional(), unit_price: z.number().min(0).optional() }).parse(req.body);
  if (b.quantity !== undefined) {
    const taken = await preorderedFor(id, Number(req.params.itemId));
    if (b.quantity < taken) throw badRequest(`Уже передзамовлено ${taken} шт. — кількість не може бути меншою`);
  }
  await query(
    'UPDATE shipment_items SET quantity = COALESCE($3, quantity), unit_price = COALESCE($4, unit_price) WHERE id = $2 AND shipment_id = $1',
    [id, Number(req.params.itemId), b.quantity ?? null, b.unit_price ?? null],
  );
  res.json(await loadShipment(id));
});

adminShipmentsRouter.delete('/shipments/:id/items/:itemId', async (req, res) => {
  const id = Number(req.params.id);
  await editable(id);
  const taken = await preorderedFor(id, Number(req.params.itemId));
  if (taken) throw badRequest(`Цю позицію вже передзамовили (${taken} шт.) — видалити не можна`);
  await query('DELETE FROM shipment_items WHERE id = $2 AND shipment_id = $1', [id, Number(req.params.itemId)]);
  res.json(await loadShipment(id));
});

// ---------- receive ----------

/** Adds the goods to stock, records the landed cost on each variant and publishes new products. */
adminShipmentsRouter.post('/shipments/:id/receive', async (req, res) => {
  const id = Number(req.params.id);
  await editable(id);
  const s = await loadShipment(id);
  if (!s!.items.length) throw badRequest('У поставці немає товарів');
  const publish = z.object({ publish: z.boolean().default(true) }).parse(req.body ?? {}).publish;
  const waiting = await preorderOrders(id);
  await tx(async (client) => {
    // pre-ordered units go straight to their orders instead of the shelf
    const reserved = new Map<number, number>();
    for (const item of s!.items) if (item.variant_id && item.preordered) reserved.set(item.variant_id, item.preordered);
    for (const item of s!.items) {
      await client.query('UPDATE shipment_items SET landed_cost = $2 WHERE id = $1', [item.id, item.unit_cost]);
      if (!item.variant_id) continue;
      const taken = Math.min(item.quantity, reserved.get(item.variant_id) ?? 0);
      reserved.set(item.variant_id, (reserved.get(item.variant_id) ?? 0) - taken);
      await client.query('UPDATE product_variants SET stock = GREATEST(0, stock + $2), cost_price = $3 WHERE id = $1', [
        item.variant_id,
        item.quantity - taken,
        item.unit_cost,
      ]);
    }
    // pre-ordered lines get the real landed cost for profit reports
    await client.query(
      `UPDATE order_items oi SET cost_price = si.landed_cost FROM shipment_items si
       WHERE oi.preorder_shipment_id = $1 AND si.shipment_id = $1 AND si.variant_id = oi.variant_id`,
      [id],
    );
    if (publish) {
      await client.query(
        `UPDATE products SET is_active = true, updated_at = now()
         WHERE id IN (SELECT product_id FROM shipment_items WHERE shipment_id = $1 AND activate_on_receive AND product_id IS NOT NULL)`,
        [id],
      );
    }
    await client.query("UPDATE shipments SET status = 'received', received_at = now() WHERE id = $1", [id]);
  });
  fireAndForget(processStockAlerts());
  const author = req.user!.name || req.user!.email;
  for (const o of waiting) {
    await addHistory(o.id, 'preorder', `Передзамовлення надійшло: поставка «${s!.title}»`, author);
    if (o.status === 'new' || o.status === 'confirmed') {
      await query("UPDATE orders SET status = 'processing', updated_at = now() WHERE id = $1", [o.id]);
      await addHistory(o.id, 'status', `${o.status === 'new' ? 'Нове' : 'Підтверджене'} → Комплектується`, author);
    }
    fireAndForget(notifyOrderStatus(o.id, { customMessage: `Гарні новини! Товари з вашого передзамовлення ${o.number} надійшли на склад — готуємо замовлення до відправки.` }));
  }
  res.json(await loadShipment(id));
});
