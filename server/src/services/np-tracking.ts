import { config } from '../config.js';
import { query } from '../db/pool.js';
import { money } from './labels.js';
import { escapeHtml as esc } from './notify/telegram.js';
import { fireAndForget, notifyAdminsTelegram, notifyOrderStatus } from './notify/index.js';
import { novaPoshtaEnabled, trackWaybills } from './novaposhta.js';
import { addHistory } from './orders.js';
import { getSettings } from './settings.js';

// Nova Poshta tracking status codes
const IN_TRANSIT = new Set(['4', '5', '6', '41', '101']);
const AT_BRANCH = new Set(['7', '8']);
const RECEIVED = new Set(['9', '10', '11']);
const REFUSED = new Set(['102', '103', '105', '108']);
// the money transfer was handed over to the sender (us)
const MONEY_PAID_OUT = '11';

/**
 * Pulls Nova Poshta statuses for open orders with a waybill and moves the order along:
 * in transit → «Відправлене», picked up → «Доставлене»; the customer is notified as usual.
 */
export async function syncTracking(): Promise<{ checked: number; updated: number }> {
  if (!novaPoshtaEnabled()) return { checked: 0, updated: 0 };
  // a waybill number typed in by hand for a cash-on-delivery order: expect the order total back
  await query(
    `UPDATE orders SET cod_status = 'awaiting', cod_amount = total
     WHERE payment_method = 'cod' AND cod_status = 'none' AND np_ttn_ref IS NULL AND tracking_number <> ''
       AND payment_status NOT IN ('paid', 'refunded') AND status NOT IN ('cancelled', 'returned')`,
  );
  const orders = await query<{
    id: number;
    number: string;
    tracking_number: string;
    customer_name: string;
    customer_phone: string;
    status: string;
    np_status_code: string;
    cod_status: string;
    cod_amount: number;
    total: number;
    refused_at: string | null;
  }>(
    `SELECT id, number, tracking_number, customer_name, customer_phone, status, np_status_code, cod_status, cod_amount, total, refused_at FROM orders
     WHERE tracking_number <> '' AND (status IN ('new', 'confirmed', 'processing', 'shipped') OR cod_status IN ('awaiting', 'collected'))
     ORDER BY updated_at DESC LIMIT 100`,
  );
  if (!orders.length) return { checked: 0, updated: 0 };
  const statuses = await trackWaybills(orders.map((o) => ({ number: o.tracking_number, phone: o.customer_phone })));
  const byNumber = new Map(statuses.map((s) => [s.Number, s]));
  let updated = 0;
  for (const o of orders) {
    const st = byNumber.get(o.tracking_number);
    if (!st || st.StatusCode === o.np_status_code) continue;
    updated++;
    await query('UPDATE orders SET np_status = $2, np_status_code = $3, np_status_at = now() WHERE id = $1', [o.id, st.Status, st.StatusCode]);
    await addHistory(o.id, 'tracking', `Нова пошта: ${st.Status}`, 'Нова пошта');

    let next: string | null = null;
    if (IN_TRANSIT.has(st.StatusCode) && ['new', 'confirmed', 'processing'].includes(o.status)) next = 'shipped';
    // orders tracked only for their COD money may already be delivered or completed
    if (RECEIVED.has(st.StatusCode) && ['new', 'confirmed', 'processing', 'shipped'].includes(o.status)) next = 'delivered';
    if (next) {
      await query('UPDATE orders SET status = $2, updated_at = now() WHERE id = $1', [o.id, next]);
      await addHistory(o.id, 'status', `Автоматично за даними Нової пошти → ${next === 'shipped' ? 'Відправлене' : 'Доставлене'}`, 'Нова пошта');
      fireAndForget(notifyOrderStatus(o.id, { statusChanged: true }));
    } else if (AT_BRANCH.has(st.StatusCode) && !AT_BRANCH.has(o.np_status_code)) {
      fireAndForget(notifyOrderStatus(o.id, { customMessage: `Ваша посилка прибула у відділення Нової пошти (ТТН ${o.tracking_number}). Чекаємо, коли заберете! 🤍` }));
    }

    if (RECEIVED.has(st.StatusCode) && o.cod_status === 'awaiting') {
      await query(
        `UPDATE orders SET cod_status = 'collected', payment_status = CASE WHEN payment_status IN ('pending', 'awaiting') THEN 'paid' ELSE payment_status END
         WHERE id = $1`,
        [o.id],
      );
      await addHistory(o.id, 'payment', `Клієнт оплатив накладений платіж ${money(Number(o.cod_amount))} — гроші йдуть на рахунок`, 'Нова пошта');
    }
    if (st.StatusCode === MONEY_PAID_OUT && (o.cod_status === 'awaiting' || o.cod_status === 'collected')) {
      await query("UPDATE orders SET cod_status = 'paid_out', cod_paid_at = now() WHERE id = $1", [o.id]);
      await addHistory(o.id, 'payment', `Гроші за накладений платіж отримано: ${money(Number(o.cod_amount))}`, 'Нова пошта');
    }
    if (REFUSED.has(st.StatusCode) && !o.refused_at) {
      await query(
        "UPDATE orders SET refused_at = now(), cod_status = CASE WHEN cod_status = 'awaiting' THEN 'refused' ELSE cod_status END WHERE id = $1",
        [o.id],
      );
      await addHistory(o.id, 'tracking', `Увага: ${st.Status}`, 'Нова пошта');
      fireAndForget(
        notifyAdminsTelegram(
          `🚫 <b>Посилку ${esc(o.number)} не забрали</b>

👤 ${esc(o.customer_name)}, ${esc(o.customer_phone)}
📦 ТТН ${esc(o.tracking_number)}: ${esc(st.Status)}
💸 ${money(Number(o.total))}`,
          [
            [{ text: '🚫 Лише передоплата для цього номера', callback_data: `o:b:${o.id}` }],
            ...(config.publicUrl.startsWith('https://') ? [[{ text: '🔗 Відкрити в адмінці', url: `${config.publicUrl}/admin/orders/${o.id}` }]] : []),
          ],
        ),
      );
    }
  }
  return { checked: orders.length, updated };
}

/** Background sync every 30 minutes while the server is awake (Render free instances sleep when idle). */
export function startTrackingJob(): void {
  const run = async () => {
    try {
      const s = await getSettings();
      if (s.novaPoshta.autoTrack) await syncTracking();
    } catch (err) {
      console.error('[np-tracking]', err instanceof Error ? err.message : err);
    }
  };
  setTimeout(run, 60_000).unref();
  setInterval(run, 30 * 60_000).unref();
}
