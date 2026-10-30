import { config } from '../../config.js';
import { phoneRisk } from '../cod.js';
import { money, orderStatusLabel, paymentStatusLabel, type OrderStatus, type PaymentStatus } from '../labels.js';
import { novaPoshtaEnabled } from '../novaposhta.js';
import { preorderWhenText, type OrderRow } from '../orders.js';
import { escapeHtml as esc, type TgKeyboard } from './telegram.js';

const CONTACT: Record<string, string> = { phone: 'дзвінок', telegram: 'Telegram', viber: 'Viber', whatsapp: 'WhatsApp', email: 'email' };
const COD: Record<string, string> = {
  awaiting: '⏳ накладений платіж: посилка в дорозі',
  collected: '💵 клієнт оплатив — гроші йдуть на рахунок',
  paid_out: '✅ гроші за накладений платіж отримано',
  refused: '🚫 відмова від посилки',
};

export function deliveryLine(o: OrderRow): string {
  return [o.delivery_name, o.delivery_city, o.delivery_branch, o.delivery_address].filter(Boolean).join(', ');
}

/** The order as the shop owner sees it in Telegram: contents, current state and risk notes. */
export async function adminOrderCard(o: OrderRow, title = '🛍 <b>Замовлення ${number}</b>'): Promise<string> {
  const items = o.items
    .map(
      (i) =>
        `• ${esc(i.name)}${i.size ? ` (${esc(i.size)})` : ''}${i.color ? `, ${esc(i.color)}` : ''} × ${i.quantity} — ${money(i.price * i.quantity)}${
          i.preorder_pending ? ` ⏳ передзамовлення (${esc(preorderWhenText(i.preorder_eta))})` : ''
        }`,
    )
    .join('\n');
  const risk = await phoneRisk(o.customer_phone, o.id);
  const warn = [
    risk.prepay_only ? '⚠️ <b>Для цього номера — лише передоплата</b>' : '',
    risk.refusals ? `⚠️ Раніше не забрали посилку: <b>${risk.refusals}</b>` : '',
  ].filter(Boolean);
  const state = [
    `📌 <b>${orderStatusLabel[o.status as OrderStatus]}</b> · ${paymentStatusLabel[o.payment_status as PaymentStatus]}`,
    o.tracking_number ? `📦 ТТН ${esc(o.tracking_number)}${o.np_status ? ` — ${esc(o.np_status)}` : ''}` : '',
    o.cod_status && o.cod_status !== 'none' ? `${COD[o.cod_status]}${Number(o.cod_amount) ? ` (${money(Number(o.cod_amount))})` : ''}` : '',
  ].filter(Boolean);
  return [
    title.replace('${number}', esc(o.number)),
    '',
    `👤 ${esc(o.customer_name)}\n📞 ${esc(o.customer_phone)}${o.customer_email ? `\n✉️ ${esc(o.customer_email)}` : ''}\n💬 Зв'язок: ${esc(CONTACT[o.contact_channel] ?? o.contact_channel)}`,
    ...(warn.length ? ['', ...warn] : []),
    '',
    items,
    '',
    `🚚 ${esc(deliveryLine(o))}\n💳 ${esc(o.payment_name)}${o.promo_code ? `\n🏷 Промокод: ${esc(o.promo_code)} (−${money(o.discount)})` : ''}`,
    '',
    `<b>Разом: ${money(o.total)}</b>${o.comment ? `\n\n📝 ${esc(o.comment)}` : ''}`,
    '',
    state.join('\n'),
  ].join('\n');
}

/** Buttons that match what can be done with the order right now. */
export function adminOrderKeyboard(o: OrderRow, risk?: { prepay_only: boolean }): TgKeyboard {
  const rows: TgKeyboard = [];
  const open = ['new', 'confirmed', 'processing'].includes(o.status);
  if (o.status === 'new') rows.push([{ text: '✅ Підтвердити', callback_data: `o:c:${o.id}` }, { text: '❌ Скасувати', callback_data: `o:x:${o.id}` }]);
  else if (open) rows.push([{ text: '❌ Скасувати', callback_data: `o:x:${o.id}` }]);
  if (open && !o.np_ttn_ref && !o.tracking_number && o.delivery_type === 'np_warehouse' && novaPoshtaEnabled()) {
    rows.push([{ text: '📦 Створити ТТН', callback_data: `o:t:${o.id}` }]);
  }
  if (o.tracking_number && novaPoshtaEnabled()) rows.push([{ text: '🏷 Наклейка 100×100', callback_data: `o:p:${o.id}` }]);
  if (o.cod_status === 'awaiting' || o.cod_status === 'collected') rows.push([{ text: '💰 Гроші отримано', callback_data: `o:m:${o.id}` }]);
  if (o.refused_at && !risk?.prepay_only) rows.push([{ text: '🚫 Лише передоплата для цього номера', callback_data: `o:b:${o.id}` }]);
  if (config.publicUrl.startsWith('https://')) rows.push([{ text: '🔗 Відкрити в адмінці', url: `${config.publicUrl}/admin/orders/${o.id}` }]);
  return rows;
}
