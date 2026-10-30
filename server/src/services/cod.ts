import { one, query } from '../db/pool.js';
import { addHistory } from './orders.js';
import { getSettings } from './settings.js';

/** Phones are matched by their last 9 digits, so +380…, 380… and 0… are the same customer. */
export const phoneKey = (phone: string) => phone.replace(/\D/g, '').slice(-9);

export const PHONE_KEY_SQL = (column: string) => `right(regexp_replace(${column}, '\\D', '', 'g'), 9)`;

export interface PhoneRisk {
  refusals: number;
  prepay_only: boolean;
  note: string;
  /** the owner decided for this phone by hand (that decision beats the automatic limit) */
  manual: boolean;
}

/** Parcels the customer did not pick up, and whether they were switched to prepayment only. */
export async function phoneRisk(phone: string, excludeOrderId?: number): Promise<PhoneRisk> {
  const key = phoneKey(phone);
  if (key.length < 9) return { refusals: 0, prepay_only: false, note: '', manual: false };
  const row = await one<{ refusals: number; prepay_only: boolean | null; note: string | null }>(
    `SELECT (SELECT COUNT(*)::int FROM orders WHERE ${PHONE_KEY_SQL('customer_phone')} = $1 AND refused_at IS NOT NULL AND id <> $2) AS refusals,
       f.prepay_only, f.note
     FROM (SELECT 1) x LEFT JOIN customer_flags f ON f.phone_key = $1`,
    [key, excludeOrderId ?? 0],
  );
  return { refusals: row?.refusals ?? 0, prepay_only: Boolean(row?.prepay_only), note: row?.note ?? '', manual: row?.prepay_only !== null && row?.prepay_only !== undefined };
}

/** Cash on delivery is refused for flagged phones or after too many parcels left at the branch. */
export async function codAllowed(phone: string): Promise<boolean> {
  const risk = await phoneRisk(phone);
  if (risk.manual) return !risk.prepay_only;
  const limit = (await getSettings()).payment.codBlockAfterRefusals;
  return !(limit > 0 && risk.refusals >= limit);
}

export async function setPrepayOnly(phone: string, on: boolean, note = ''): Promise<void> {
  await query(
    `INSERT INTO customer_flags(phone_key, prepay_only, note) VALUES ($1, $2, $3)
     ON CONFLICT (phone_key) DO UPDATE SET prepay_only = $2, note = CASE WHEN $3 <> '' THEN $3 ELSE customer_flags.note END, updated_at = now()`,
    [phoneKey(phone), on, note],
  );
}

/** The money for a cash-on-delivery parcel reached the store. */
export async function markCodPaid(orderId: number, author: string): Promise<boolean> {
  const row = await one<{ cod_amount: number }>(
    `UPDATE orders SET cod_status = 'paid_out', cod_paid_at = now(),
       payment_status = CASE WHEN payment_status IN ('pending', 'awaiting') THEN 'paid' ELSE payment_status END, updated_at = now()
     WHERE id = $1 AND cod_status IN ('awaiting', 'collected') RETURNING cod_amount`,
    [orderId],
  );
  if (!row) return false;
  await addHistory(orderId, 'payment', `Гроші за накладений платіж отримано: ${Math.round(row.cod_amount)} ₴`, author);
  return true;
}

/** Totals for the COD page and the bot's /cod command. */
export async function codSummary() {
  return one<{
    awaiting_count: number;
    awaiting_sum: number;
    collected_count: number;
    collected_sum: number;
    paid_30_count: number;
    paid_30_sum: number;
    refused_90: number;
    refused_90_sum: number;
    shipped_90: number;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE cod_status = 'awaiting')::int AS awaiting_count,
       COALESCE(SUM(cod_amount) FILTER (WHERE cod_status = 'awaiting'), 0) AS awaiting_sum,
       COUNT(*) FILTER (WHERE cod_status = 'collected')::int AS collected_count,
       COALESCE(SUM(cod_amount) FILTER (WHERE cod_status = 'collected'), 0) AS collected_sum,
       COUNT(*) FILTER (WHERE cod_status = 'paid_out' AND cod_paid_at >= now() - interval '30 days')::int AS paid_30_count,
       COALESCE(SUM(cod_amount) FILTER (WHERE cod_status = 'paid_out' AND cod_paid_at >= now() - interval '30 days'), 0) AS paid_30_sum,
       COUNT(*) FILTER (WHERE refused_at >= now() - interval '90 days')::int AS refused_90,
       COALESCE(SUM(cod_amount) FILTER (WHERE refused_at >= now() - interval '90 days'), 0) AS refused_90_sum,
       COUNT(*) FILTER (WHERE cod_amount > 0 AND created_at >= now() - interval '90 days')::int AS shipped_90
     FROM orders`,
  );
}
