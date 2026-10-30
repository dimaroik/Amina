import type { PoolClient } from 'pg';
import { one, query, tx } from '../db/pool.js';
import { orderStatusLabel, type OrderStatus } from './labels.js';
import { createRecipient, createWaybill, getSender } from './novaposhta.js';
import { fireAndForget, notifyOrderStatus } from './notify/index.js';
import { addHistory, PENDING_PREORDER_SQL } from './orders.js';
import { getSettings } from './settings.js';
import { processStockAlerts } from './stock-alerts.js';
import { badRequest, notFound } from '../utils/errors.js';

/** Returns stock when an order moves into a cancelled/returned state, and takes it back when restored. */
export async function syncStock(client: PoolClient, orderId: number, from: string, to: string) {
  const released = (s: string) => s === 'cancelled' || s === 'returned';
  if (released(from) === released(to)) return;
  const sign = released(to) ? 1 : -1;
  // lines pre-ordered from a shipment still on the way never took stock
  await client.query(
    `UPDATE product_variants v SET stock = GREATEST(0, v.stock + $2 * t.qty)
     FROM (SELECT oi.variant_id, SUM(oi.quantity) AS qty FROM order_items oi
           WHERE oi.order_id = $1 AND oi.variant_id IS NOT NULL AND NOT ${PENDING_PREORDER_SQL} GROUP BY oi.variant_id) t
     WHERE v.id = t.variant_id`,
    [orderId, sign],
  );
}

/** Status change with stock sync, history and (optionally) a customer notification. */
export async function setOrderStatus(
  id: number,
  status: OrderStatus,
  opts: { author: string; notify?: boolean; note?: string },
): Promise<boolean> {
  const changed = await tx(async (client) => {
    const { rows: [o] } = await client.query('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [id]);
    if (!o) throw notFound('Замовлення не знайдено');
    if (o.status === status) return null;
    await client.query('UPDATE orders SET status = $2, updated_at = now() WHERE id = $1', [id, status]);
    await syncStock(client, id, o.status, status);
    return o.status as OrderStatus;
  });
  if (!changed) return false;
  await addHistory(id, 'status', `${orderStatusLabel[changed]} → ${orderStatusLabel[status]}${opts.note ? `. ${opts.note}` : ''}`, opts.author);
  if (opts.notify !== false) fireAndForget(notifyOrderStatus(id, { statusChanged: true }));
  fireAndForget(processStockAlerts());
  return true;
}

export interface OrderWaybillInput {
  firstName: string;
  lastName: string;
  phone: string;
  cityRef: string;
  cityName: string;
  warehouseRef: string;
  warehouseName: string;
  weight: number;
  declaredValue: number;
  description: string;
  payer: 'Recipient' | 'Sender';
  codAmount: number;
  markShipped: boolean;
}

/** The same defaults the admin TTN dialog starts with. */
export async function defaultWaybillInput(o: Record<string, any>): Promise<OrderWaybillInput> {
  const np = (await getSettings()).novaPoshta;
  const parts = String(o.customer_name).trim().split(/\s+/);
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' ') || (parts[0] ?? ''),
    phone: o.customer_phone,
    cityRef: o.delivery_city_ref ?? '',
    cityName: o.delivery_city ?? '',
    warehouseRef: o.delivery_branch_ref ?? '',
    warehouseName: o.delivery_branch ?? '',
    weight: np.defaultWeight,
    declaredValue: Math.round(Number(o.total)),
    description: np.defaultDescription,
    payer: np.payer,
    codAmount: o.payment_method === 'cod' && o.payment_status !== 'paid' ? Math.round(Number(o.total)) : 0,
    markShipped: true,
  };
}

/** Creates a Nova Poshta waybill for the order and records it (tracking, COD amount, optional «shipped»). */
export async function createOrderWaybill(id: number, body: OrderWaybillInput, author: string) {
  const order = await one('SELECT * FROM orders WHERE id = $1', [id]);
  if (!order) throw notFound('Замовлення не знайдено');
  if (order.np_ttn_ref) throw badRequest('Для цього замовлення ТТН уже створено');
  const s = (await getSettings()).novaPoshta;
  if (!s.senderCityRef || !s.senderWarehouseRef || !s.senderPhone) {
    throw badRequest('Спершу вкажіть відділення відправки й телефон у Налаштування → Нова пошта');
  }
  if (!body.cityRef || !body.warehouseRef) throw badRequest('Не вибрано місто або відділення Нової пошти зі списку');
  const sender = await getSender();
  const recipient = await createRecipient(body.firstName, body.lastName, body.phone);
  const doc = await createWaybill({
    sender: { ref: sender.ref, contactRef: sender.contactRef, cityRef: s.senderCityRef, warehouseRef: s.senderWarehouseRef, phone: s.senderPhone },
    recipient: { ref: recipient.ref, contactRef: recipient.contactRef, cityRef: body.cityRef, warehouseRef: body.warehouseRef, phone: body.phone },
    weight: body.weight,
    declaredValue: body.declaredValue,
    description: body.description,
    payer: body.payer,
    codAmount: body.codAmount,
  });
  await query(
    `UPDATE orders SET tracking_number = $2, np_ttn_ref = $3, np_status = 'Створено', np_status_code = '1', np_status_at = now(),
       delivery_city_ref = $4, delivery_branch_ref = $5,
       delivery_city = CASE WHEN $6 <> '' THEN $6 ELSE delivery_city END,
       delivery_branch = CASE WHEN $7 <> '' THEN $7 ELSE delivery_branch END,
       cod_amount = $8::numeric, cod_status = CASE WHEN $8::numeric > 0 THEN 'awaiting' ELSE 'none' END,
       updated_at = now()
     WHERE id = $1`,
    [id, doc.IntDocNumber, doc.Ref, body.cityRef, body.warehouseRef, body.cityName, body.warehouseName, body.codAmount],
  );
  await addHistory(
    id,
    'tracking',
    `Створено ТТН ${doc.IntDocNumber}${body.codAmount > 0 ? ` · накладений платіж ${body.codAmount} ₴` : ''}${doc.CostOnSite ? ` · доставка ≈ ${doc.CostOnSite} ₴` : ''}`,
    author,
  );
  if (body.markShipped && order.status !== 'shipped') await setOrderStatus(id, 'shipped', { author });
  return doc;
}
