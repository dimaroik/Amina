import { config } from '../../config.js';
import { money, orderStatusLabel, paymentStatusLabel, statusMessage, type OrderStatus, type PaymentStatus } from '../labels.js';
import { jarLink } from '../monobank.js';
import { getOrderFull, type OrderRow } from '../orders.js';
import { getSettings, type Settings } from '../settings.js';
import { emailEnabled, sendEmail } from './email.js';
import { logNotification } from './log.js';
import { escapeHtml, sendTelegram, telegramEnabled } from './telegram.js';
import { sendViber, viberEnabled } from './viber.js';
import { sendWhatsappTemplate, whatsappEnabled } from './whatsapp.js';

const esc = escapeHtml;

function orderUrl(o: OrderRow): string {
  return `${config.publicUrl}/order/${o.number}?token=${o.access_token}`;
}

function deliveryLine(o: OrderRow): string {
  return [o.delivery_name, o.delivery_city, o.delivery_branch, o.delivery_address].filter(Boolean).join(', ');
}

function absoluteUrl(url: string | null): string {
  if (!url) return '';
  return url.startsWith('http') ? url : `${config.publicUrl}${url}`;
}

function paymentInstructions(o: OrderRow, s: Settings): string {
  if (o.payment_status === 'paid') return '';
  const purpose = s.payment.paymentPurpose.replace('{number}', o.number);
  if (o.payment_method === 'mono_jar' && s.payment.monoJarUrl) {
    const link = jarLink(s.payment.monoJarUrl, o.total, purpose);
    return `<p style="margin:0 0 8px">Оплатіть ${money(o.total)} на банку Monobank:</p>
      <p><a href="${esc(link)}" style="display:inline-block;background:#1f1d1a;color:#fff;padding:12px 22px;text-decoration:none;letter-spacing:.06em;font-size:13px">ОПЛАТИТИ В MONOBANK</a></p>
      <p style="color:#7a7268;font-size:13px">У коментарі вкажіть номер замовлення ${esc(o.number)}.</p>`;
  }
  if (o.payment_method === 'iban' && s.payment.iban) {
    return `<p style="margin:0 0 8px">Реквізити для оплати:</p>
      <p style="font-size:14px;line-height:1.7">Отримувач: ${esc(s.payment.recipient)}<br>IBAN: <b>${esc(s.payment.iban)}</b><br>
      ${s.payment.edrpou ? `ЄДРПОУ/ІПН: ${esc(s.payment.edrpou)}<br>` : ''}Сума: <b>${money(o.total)}</b><br>Призначення: ${esc(purpose)}</p>`;
  }
  if (o.payment_method === 'mono_acquiring' && o.payment_url) {
    return `<p><a href="${esc(o.payment_url)}" style="display:inline-block;background:#1f1d1a;color:#fff;padding:12px 22px;text-decoration:none;letter-spacing:.06em;font-size:13px">ОПЛАТИТИ КАРТКОЮ</a></p>`;
  }
  if (o.payment_method === 'cod') return '<p>Оплата при отриманні у відділенні.</p>';
  return '';
}

function layout(s: Settings, title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f3ee;font-family:Helvetica,Arial,sans-serif;color:#1f1d1a">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3ee;padding:32px 12px"><tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff">
    <tr><td style="padding:32px 32px 8px;text-align:center;font-family:Georgia,serif;font-size:30px;letter-spacing:.32em">${esc(s.store.name.toUpperCase())}</td></tr>
    <tr><td style="padding:8px 32px 0;text-align:center;font-size:12px;letter-spacing:.2em;color:#9a8f82">${esc(s.store.tagline.toUpperCase())}</td></tr>
    <tr><td style="padding:32px"><h1 style="font-family:Georgia,serif;font-weight:400;font-size:24px;margin:0 0 16px">${title}</h1>${body}</td></tr>
    <tr><td style="padding:24px 32px;border-top:1px solid #eee7dd;font-size:12px;color:#9a8f82;text-align:center">
      ${esc(s.store.phone)} · ${esc(s.store.email)}<br>${esc(s.store.workHours)}</td></tr>
  </table></td></tr></table></body></html>`;
}

function itemsTable(o: OrderRow): string {
  const rows = o.items
    .map(
      (i) => `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0ebe4;width:64px">${
          i.image_url ? `<img src="${esc(absoluteUrl(i.image_url))}" width="56" height="72" style="object-fit:cover;display:block">` : ''
        }</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0ebe4;font-size:14px">${esc(i.name)}<br>
          <span style="color:#9a8f82;font-size:12px">${[i.size && `Розмір: ${esc(i.size)}`, i.color && `Колір: ${esc(i.color)}`].filter(Boolean).join(' · ')} · ${i.quantity} шт.</span></td>
        <td style="padding:10px 0;border-bottom:1px solid #f0ebe4;text-align:right;font-size:14px;white-space:nowrap">${money(i.price * i.quantity)}</td>
      </tr>`,
    )
    .join('');
  return `<table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;font-size:14px">
      <tr><td style="padding:4px 0;color:#7a7268">Товари</td><td style="text-align:right">${money(o.subtotal)}</td></tr>
      ${o.discount > 0 ? `<tr><td style="padding:4px 0;color:#7a7268">Знижка</td><td style="text-align:right">−${money(o.discount)}</td></tr>` : ''}
      <tr><td style="padding:4px 0;color:#7a7268">Доставка</td><td style="text-align:right">${o.delivery_cost > 0 ? money(o.delivery_cost) : 'за тарифами перевізника'}</td></tr>
      <tr><td style="padding:10px 0 0;font-size:16px"><b>Разом</b></td><td style="padding:10px 0 0;text-align:right;font-size:16px"><b>${money(o.total)}</b></td></tr>
    </table>`;
}

function adminTelegramText(o: OrderRow): string {
  const items = o.items.map((i) => `• ${esc(i.name)}${i.size ? ` (${esc(i.size)})` : ''}${i.color ? `, ${esc(i.color)}` : ''} × ${i.quantity} — ${money(i.price * i.quantity)}`).join('\n');
  return `🛍 <b>Нове замовлення ${esc(o.number)}</b>\n\n👤 ${esc(o.customer_name)}\n📞 ${esc(o.customer_phone)}${
    o.customer_email ? `\n✉️ ${esc(o.customer_email)}` : ''
  }\n💬 Зв'язок: ${esc(o.contact_channel)}\n\n${items}\n\n🚚 ${esc(deliveryLine(o))}\n💳 ${esc(o.payment_name)}${
    o.promo_code ? `\n🏷 Промокод: ${esc(o.promo_code)} (−${money(o.discount)})` : ''
  }\n\n<b>Разом: ${money(o.total)}</b>${o.comment ? `\n\n📝 ${esc(o.comment)}` : ''}`;
}

export async function notifyOrderCreated(orderId: number): Promise<void> {
  const o = await getOrderFull(orderId);
  if (!o) return;
  const s = await getSettings();
  const tasks: Promise<unknown>[] = [];

  if (emailEnabled() && o.customer_email && s.notifications.notifyCustomerEmail) {
    const subject = `Замовлення ${o.number} прийнято — ${s.store.name}`;
    const html = layout(
      s,
      `Дякуємо, ${esc(o.customer_name.split(' ')[0] ?? '')}!`,
      `<p style="line-height:1.6">Ваше замовлення <b>${esc(o.number)}</b> прийнято. Ми зв'яжемося з вами найближчим часом для підтвердження.</p>
       ${paymentInstructions(o, s)}
       <h3 style="font-family:Georgia,serif;font-weight:400;margin:28px 0 8px">Ваше замовлення</h3>${itemsTable(o)}
       <p style="margin-top:24px;font-size:14px;line-height:1.6;color:#4a443d">Доставка: ${esc(deliveryLine(o))}</p>
       <p style="margin-top:24px"><a href="${esc(orderUrl(o))}" style="color:#1f1d1a">Переглянути статус замовлення →</a></p>`,
    );
    tasks.push(logNotification(o.id, 'email', o.customer_email, subject, () => sendEmail(o.customer_email, subject, html)));
  }

  if (emailEnabled()) {
    for (const adminEmail of s.notifications.adminEmails) {
      const subject = `🛍 Нове замовлення ${o.number} на ${money(o.total)}`;
      const html = layout(
        s,
        `Нове замовлення ${esc(o.number)}`,
        `<p style="line-height:1.7">${esc(o.customer_name)}<br>${esc(o.customer_phone)}<br>${esc(o.customer_email)}<br>
         Зв'язок: ${esc(o.contact_channel)}<br>${esc(deliveryLine(o))}<br>${esc(o.payment_name)}</p>
         ${o.comment ? `<p style="background:#f6f3ee;padding:12px">${esc(o.comment)}</p>` : ''}
         ${itemsTable(o)}
         <p style="margin-top:24px"><a href="${config.publicUrl}/admin/orders/${o.id}" style="color:#1f1d1a">Відкрити в адмінці →</a></p>`,
      );
      tasks.push(logNotification(o.id, 'email', adminEmail, subject, () => sendEmail(adminEmail, subject, html)));
    }
  }

  if (telegramEnabled()) {
    const text = adminTelegramText(o);
    const buttons = config.publicUrl.startsWith('https://')
      ? [{ text: 'Відкрити в адмінці', url: `${config.publicUrl}/admin/orders/${o.id}` }]
      : undefined;
    for (const chatId of s.notifications.telegramAdminChatIds) {
      tasks.push(logNotification(o.id, 'telegram', chatId, 'new order', () => sendTelegram(chatId, text, buttons)));
    }
  }

  if (viberEnabled()) {
    const text = adminTelegramText(o).replace(/<[^>]+>/g, '');
    for (const id of s.notifications.viberAdminIds) {
      tasks.push(logNotification(o.id, 'viber', id, 'new order', () => sendViber(id, text)));
    }
  }

  if (whatsappEnabled() && s.notifications.notifyCustomerWhatsapp) {
    const params = [o.customer_name, o.number, orderStatusLabel.new, money(o.total)];
    tasks.push(logNotification(o.id, 'whatsapp', o.customer_phone, 'order created', () => sendWhatsappTemplate(o.customer_phone, params)));
  }

  await Promise.allSettled(tasks);
}

export async function notifyOrderStatus(
  orderId: number,
  opts: { statusChanged?: boolean; paymentChanged?: boolean; customMessage?: string },
): Promise<void> {
  const o = await getOrderFull(orderId);
  if (!o) return;
  const s = await getSettings();
  const status = o.status as OrderStatus;
  const pay = o.payment_status as PaymentStatus;

  const lines: string[] = [];
  if (opts.customMessage) lines.push(opts.customMessage);
  else {
    if (opts.statusChanged) lines.push(statusMessage[status] ?? `Статус замовлення: ${orderStatusLabel[status]}.`);
    if (opts.paymentChanged && pay === 'paid') lines.push('Оплату отримано, дякуємо!');
    if (opts.paymentChanged && pay === 'refunded') lines.push('Кошти за замовлення повернено.');
  }
  if (status === 'shipped' && o.tracking_number) lines.push(`Номер ТТН: ${o.tracking_number}`);
  if (!lines.length) return;

  const subject = `Замовлення ${o.number}: ${orderStatusLabel[status].toLowerCase()}`;
  const plain = `${s.store.name} · Замовлення ${o.number}\n\n${lines.join('\n')}\n\nСтатус: ${orderStatusLabel[status]} · ${paymentStatusLabel[pay]}\n${orderUrl(o)}`;
  const tasks: Promise<unknown>[] = [];

  if (emailEnabled() && o.customer_email && s.notifications.notifyCustomerEmail) {
    const trackLink =
      status === 'shipped' && o.tracking_number
        ? `<p><a href="https://novaposhta.ua/tracking/?cargo_number=${encodeURIComponent(o.tracking_number)}" style="color:#1f1d1a">Відстежити посилку →</a></p>`
        : '';
    const html = layout(
      s,
      `Замовлення ${esc(o.number)}`,
      `${lines.map((l) => `<p style="line-height:1.6">${esc(l)}</p>`).join('')}${trackLink}
       <p style="margin:20px 0;padding:14px 16px;background:#f6f3ee;font-size:14px">Статус: <b>${orderStatusLabel[status]}</b> · ${paymentStatusLabel[pay]}</p>
       <p><a href="${esc(orderUrl(o))}" style="color:#1f1d1a">Деталі замовлення →</a></p>`,
    );
    tasks.push(logNotification(o.id, 'email', o.customer_email, subject, () => sendEmail(o.customer_email, subject, html)));
  }
  if (telegramEnabled() && o.telegram_chat_id) {
    const chatId = o.telegram_chat_id;
    tasks.push(logNotification(o.id, 'telegram', chatId, subject, () => sendTelegram(chatId, esc(plain))));
  }
  if (viberEnabled() && o.viber_user_id) {
    const viberId = o.viber_user_id;
    tasks.push(logNotification(o.id, 'viber', viberId, subject, () => sendViber(viberId, plain)));
  }
  if (whatsappEnabled() && s.notifications.notifyCustomerWhatsapp) {
    const params = [o.customer_name, o.number, orderStatusLabel[status], lines.join(' ')];
    tasks.push(logNotification(o.id, 'whatsapp', o.customer_phone, subject, () => sendWhatsappTemplate(o.customer_phone, params)));
  }
  await Promise.allSettled(tasks);
}

export async function notifyChatHandoff(sessionId: string, contact: string, message: string): Promise<void> {
  const s = await getSettings();
  if (!s.notifications.notifyAdminOnChatHandoff) return;
  const text = `💬 <b>Клієнт просить зв'язатися з менеджером</b>\n\n📞 ${esc(contact)}\n📝 ${esc(message)}`;
  const link = config.publicUrl.startsWith('https://') ? [{ text: 'Переглянути чат', url: `${config.publicUrl}/admin/chats/${sessionId}` }] : undefined;
  const tasks: Promise<unknown>[] = [];
  if (telegramEnabled()) {
    for (const chatId of s.notifications.telegramAdminChatIds) {
      tasks.push(logNotification(null, 'telegram', chatId, 'chat handoff', () => sendTelegram(chatId, text, link)));
    }
  }
  if (viberEnabled()) {
    for (const id of s.notifications.viberAdminIds) {
      tasks.push(logNotification(null, 'viber', id, 'chat handoff', () => sendViber(id, text.replace(/<[^>]+>/g, ''))));
    }
  }
  if (emailEnabled()) {
    for (const adminEmail of s.notifications.adminEmails) {
      tasks.push(
        logNotification(null, 'email', adminEmail, 'chat handoff', () =>
          sendEmail(adminEmail, `💬 Запит з чату: ${contact}`, layout(s, 'Запит з чату', `<p>${esc(contact)}</p><p>${esc(message)}</p>`)),
        ),
      );
    }
  }
  await Promise.allSettled(tasks);
}

export function fireAndForget(p: Promise<unknown>): void {
  p.catch((err) => console.error('[notify]', err));
}
