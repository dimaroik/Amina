import { query } from '../db/pool.js';
import { fireAndForget, notifyOrderStatus } from './notify/index.js';
import { novaPoshtaEnabled, trackWaybills } from './novaposhta.js';
import { addHistory } from './orders.js';
import { getSettings } from './settings.js';

// Nova Poshta tracking status codes
const IN_TRANSIT = new Set(['4', '5', '6', '41', '101']);
const AT_BRANCH = new Set(['7', '8']);
const RECEIVED = new Set(['9', '10', '11']);
const REFUSED = new Set(['102', '103', '105', '108']);

/**
 * Pulls Nova Poshta statuses for open orders with a waybill and moves the order along:
 * in transit → «Відправлене», picked up → «Доставлене»; the customer is notified as usual.
 */
export async function syncTracking(): Promise<{ checked: number; updated: number }> {
  if (!novaPoshtaEnabled()) return { checked: 0, updated: 0 };
  const orders = await query<{ id: number; tracking_number: string; customer_phone: string; status: string; np_status_code: string }>(
    `SELECT id, tracking_number, customer_phone, status, np_status_code FROM orders
     WHERE tracking_number <> '' AND status IN ('new', 'confirmed', 'processing', 'shipped')
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
    if (RECEIVED.has(st.StatusCode)) next = 'delivered';
    if (next) {
      await query('UPDATE orders SET status = $2, updated_at = now() WHERE id = $1', [o.id, next]);
      await addHistory(o.id, 'status', `Автоматично за даними Нової пошти → ${next === 'shipped' ? 'Відправлене' : 'Доставлене'}`, 'Нова пошта');
      fireAndForget(notifyOrderStatus(o.id, { statusChanged: true }));
    } else if (AT_BRANCH.has(st.StatusCode) && !AT_BRANCH.has(o.np_status_code)) {
      fireAndForget(notifyOrderStatus(o.id, { customMessage: `Ваша посилка прибула у відділення Нової пошти (ТТН ${o.tracking_number}). Чекаємо, коли заберете! 🤍` }));
    } else if (REFUSED.has(st.StatusCode)) {
      await addHistory(o.id, 'tracking', 'Увага: відмова від отримання або повернення посилки', 'Нова пошта');
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
