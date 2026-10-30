import { one, query } from '../db/pool.js';
import { codSummary, markCodPaid, phoneRisk, setPrepayOnly } from './cod.js';
import { money, orderStatusLabel, type OrderStatus } from './labels.js';
import { NovaPoshtaError, waybillPdf } from './novaposhta.js';
import { adminOrderCard, adminOrderKeyboard } from './notify/admin-card.js';
import { answerCallback, api, editTelegram, escapeHtml as esc, sendTelegram, sendTelegramDocument, telegramEnabled } from './notify/telegram.js';
import { createOrderWaybill, defaultWaybillInput, setOrderStatus } from './order-actions.js';
import { getOrderFull } from './orders.js';
import { getSettings } from './settings.js';

/** Only chats listed in Налаштування → Сповіщення may manage orders from Telegram. */
export async function isAdminChat(id: string | number): Promise<boolean> {
  return (await getSettings()).notifications.telegramAdminChatIds.includes(String(id));
}

const HELP = `<b>Amina · керування з Telegram</b>

Під кожним новим замовленням є кнопки: підтвердити, скасувати, створити ТТН, надрукувати наклейку, позначити отримані гроші.

/orders — замовлення, що чекають на вас
/today — продажі за сьогодні
/cod — накладений платіж і невикупи
/help — ця довідка`;

interface CallbackQuery {
  id: string;
  from: { id: number; first_name?: string; username?: string };
  data?: string;
  message?: { message_id: number; chat: { id: number } };
}

async function refresh(chatId: number, messageId: number, orderId: number, title?: string) {
  const o = await getOrderFull(orderId);
  if (!o) return;
  const risk = await phoneRisk(o.customer_phone, o.id);
  await editTelegram(chatId, messageId, await adminOrderCard(o, title), adminOrderKeyboard(o, risk));
}

/** Button presses under order cards. Data format: `o:<action>:<orderId>`. */
export async function handleAdminCallback(cb: CallbackQuery): Promise<void> {
  // a personal admin chat, or a group listed as an admin chat (everyone in it manages orders)
  if (!(await isAdminChat(cb.from.id)) && !(cb.message && (await isAdminChat(cb.message.chat.id)))) {
    await answerCallback(cb.id, 'Немає доступу. Додайте свій chat ID в адмінці → Налаштування → Сповіщення.', true);
    return;
  }
  if (cb.data === 'cmd:orders' && cb.message) {
    await answerCallback(cb.id);
    await handleAdminCommand(String(cb.message.chat.id), '/orders');
    return;
  }
  const m = cb.data?.match(/^o:([a-zA-Z]):(\d+)$/);
  const msg = cb.message;
  if (!m || !msg) return answerCallback(cb.id);
  const [, action, idStr] = m;
  const id = Number(idStr);
  const chatId = msg.chat.id;
  const author = `Telegram · ${cb.from.first_name ?? cb.from.username ?? cb.from.id}`;
  const order = await getOrderFull(id);
  if (!order) return answerCallback(cb.id, 'Замовлення не знайдено (можливо, видалене)', true);

  try {
    switch (action) {
      case 'r': // back to the card
        await refresh(chatId, msg.message_id, id);
        return answerCallback(cb.id);

      case 'c':
        if (order.status !== 'new') return answerCallback(cb.id, `Уже: ${orderStatusLabel[order.status as OrderStatus]}`);
        await setOrderStatus(id, 'confirmed', { author });
        await refresh(chatId, msg.message_id, id);
        return answerCallback(cb.id, '✅ Підтверджено, клієнта сповіщено');

      case 'x': // ask first — cancelling returns stock and notifies the customer
        await editTelegram(chatId, msg.message_id, `${await adminOrderCard(order)}\n\n<b>Скасувати замовлення ${esc(order.number)}?</b> Товари повернуться на склад, клієнт отримає повідомлення.`, [
          [{ text: '❌ Так, скасувати', callback_data: `o:X:${id}` }],
          [{ text: '← Назад', callback_data: `o:r:${id}` }],
        ]);
        return answerCallback(cb.id);

      case 'X':
        await setOrderStatus(id, 'cancelled', { author });
        await refresh(chatId, msg.message_id, id);
        return answerCallback(cb.id, 'Замовлення скасовано');

      case 't': {
        const w = await defaultWaybillInput(order);
        if (!w.warehouseRef) {
          return answerCallback(cb.id, 'Відділення не вибране зі списку Нової пошти — створіть ТТН в адмінці.', true);
        }
        await editTelegram(
          chatId,
          msg.message_id,
          `${await adminOrderCard(order)}\n\n<b>Створити ТТН?</b>\n👤 ${esc(`${w.lastName} ${w.firstName}`)}, ${esc(w.phone)}\n📍 ${esc(w.cityName)}, ${esc(w.warehouseName)}\n⚖️ ${w.weight} кг · оголошена вартість ${money(w.declaredValue)}\n💵 ${
            w.codAmount ? `накладений платіж ${money(w.codAmount)}` : 'без накладеного платежу'
          } · доставку оплачує ${w.payer === 'Recipient' ? 'отримувач' : 'магазин'}\n\nПісля створення замовлення стане «Відправлене».`,
          [
            [{ text: '📦 Так, створити ТТН', callback_data: `o:T:${id}` }],
            [{ text: '← Назад', callback_data: `o:r:${id}` }],
          ],
        );
        return answerCallback(cb.id);
      }

      case 'T': {
        await answerCallback(cb.id, 'Створюємо ТТН…');
        const doc = await createOrderWaybill(id, await defaultWaybillInput(order), author);
        await refresh(chatId, msg.message_id, id);
        await sendTelegram(String(chatId), `📦 ТТН <b>${esc(doc.IntDocNumber)}</b> для ${esc(order.number)} створено${doc.CostOnSite ? ` · доставка ≈ ${money(Number(doc.CostOnSite))}` : ''}.`, [
          [{ text: '🏷 Наклейка 100×100', callback_data: `o:p:${id}` }],
        ]);
        return;
      }

      case 'p': {
        if (!order.tracking_number) return answerCallback(cb.id, 'ТТН ще немає', true);
        await answerCallback(cb.id, 'Готуємо PDF…');
        const pdf = await waybillPdf(order.tracking_number, 'marking');
        await sendTelegramDocument(String(chatId), pdf, `ttn-${order.tracking_number}.pdf`, `🏷 ${esc(order.number)} · ТТН ${esc(order.tracking_number)}`);
        return;
      }

      case 'm':
        if (!(await markCodPaid(id, author))) return answerCallback(cb.id, 'Немає очікуваного накладеного платежу');
        await refresh(chatId, msg.message_id, id);
        return answerCallback(cb.id, '💰 Позначено: гроші отримано');

      case 'b':
        await setPrepayOnly(order.customer_phone, true, `Не забрали посилку ${order.number}`);
        await editTelegram(chatId, msg.message_id, `${await adminOrderCard(order)}\n\n🚫 Для номера ${esc(order.customer_phone)} тепер лише передоплата.`, adminOrderKeyboard(order, { prepay_only: true }));
        return answerCallback(cb.id, 'Готово: для цього номера лише передоплата');

      case 'v': // show a card (from /orders)
        await sendTelegram(String(chatId), await adminOrderCard(order), adminOrderKeyboard(order, await phoneRisk(order.customer_phone, order.id)));
        return answerCallback(cb.id);
    }
    return answerCallback(cb.id);
  } catch (err) {
    console.error('[admin bot]', err);
    const text = err instanceof NovaPoshtaError || (err as { status?: number })?.status ? (err as Error).message : 'Не вдалося — спробуйте в адмінці';
    await answerCallback(cb.id, text.slice(0, 190), true);
  }
}

/** Commands from admin chats; returns false when the text is not an admin command. */
export async function handleAdminCommand(chatId: string, text: string): Promise<boolean> {
  const cmd = text.trim().split(/[\s@]/)[0]!.toLowerCase();
  if (!['/orders', '/today', '/cod', '/help', '/start'].includes(cmd)) return false;
  if (!(await isAdminChat(chatId))) return cmd === '/orders' || cmd === '/today' || cmd === '/cod' ? (await sendTelegram(chatId, 'Ці команди доступні лише адміністраторам магазину.'), true) : false;

  if (cmd === '/help' || cmd === '/start') {
    await sendTelegram(chatId, HELP);
    return true;
  }

  if (cmd === '/orders') {
    const rows = await query<{ id: number; number: string; status: OrderStatus; customer_name: string; total: number }>(
      `SELECT id, number, status, customer_name, total FROM orders
       WHERE status IN ('new', 'confirmed', 'processing') ORDER BY (status = 'new') DESC, created_at LIMIT 20`,
    );
    if (!rows.length) {
      await sendTelegram(chatId, '🎉 Усі замовлення оброблено — нових немає.');
      return true;
    }
    const groups = (['new', 'confirmed', 'processing'] as OrderStatus[])
      .map((st) => {
        const list = rows.filter((r) => r.status === st);
        return list.length ? `<b>${orderStatusLabel[st]} (${list.length})</b>\n${list.map((r) => `• ${esc(r.number)} — ${esc(r.customer_name)}, ${money(Number(r.total))}`).join('\n')}` : '';
      })
      .filter(Boolean);
    await sendTelegram(
      chatId,
      `🗂 <b>Замовлення в роботі</b>\n\n${groups.join('\n\n')}\n\nНатисніть, щоб відкрити картку з кнопками:`,
      rows.slice(0, 12).map((r) => [{ text: `${r.status === 'new' ? '🆕 ' : ''}${r.number} · ${money(Number(r.total))}`, callback_data: `o:v:${r.id}` }]),
    );
    return true;
  }

  if (cmd === '/today') {
    const t = await one<{ orders: number; revenue: number; items: number; new_count: number; cancelled: number }>(
      `SELECT COUNT(*) FILTER (WHERE status NOT IN ('cancelled', 'returned'))::int AS orders,
         COALESCE(SUM(total) FILTER (WHERE status NOT IN ('cancelled', 'returned')), 0) AS revenue,
         COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o2 ON o2.id = oi.order_id
           WHERE o2.created_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Kyiv') AT TIME ZONE 'Europe/Kyiv' AND o2.status NOT IN ('cancelled', 'returned')), 0)::int AS items,
         (SELECT COUNT(*)::int FROM orders WHERE status = 'new') AS new_count,
         COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
       FROM orders WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Kyiv') AT TIME ZONE 'Europe/Kyiv'`,
    );
    await sendTelegram(
      chatId,
      `📊 <b>Сьогодні</b>\n\nЗамовлень: <b>${t?.orders ?? 0}</b>\nНа суму: <b>${money(Number(t?.revenue ?? 0))}</b>\nРечей: ${t?.items ?? 0}${t?.cancelled ? `\nСкасовано: ${t.cancelled}` : ''}\n\nЧекають на підтвердження: <b>${t?.new_count ?? 0}</b>`,
      t?.new_count ? [[{ text: '🗂 Відкрити нові', callback_data: 'cmd:orders' }]] : undefined,
    );
    return true;
  }

  // /cod
  const c = await codSummary();
  const rate = c && c.shipped_90 ? Math.round((c.refused_90 / c.shipped_90) * 100) : 0;
  await sendTelegram(
    chatId,
    `💵 <b>Накладений платіж</b>\n\nВ дорозі до клієнтів: <b>${money(Number(c?.awaiting_sum ?? 0))}</b> (${c?.awaiting_count ?? 0})\nКлієнти оплатили, гроші йдуть: <b>${money(Number(c?.collected_sum ?? 0))}</b> (${c?.collected_count ?? 0})\nОтримано за 30 днів: ${money(Number(c?.paid_30_sum ?? 0))} (${c?.paid_30_count ?? 0})\n\n🚫 Не забрали за 90 днів: <b>${c?.refused_90 ?? 0}</b>${rate ? ` (${rate}% посилок з накладеним)` : ''}`,
  );
  return true;
}

/** Shows the admin commands in the bot menu of each admin chat. */
export async function setupAdminCommands(): Promise<void> {
  if (!telegramEnabled()) return;
  const commands = [
    { command: 'orders', description: 'Замовлення в роботі' },
    { command: 'today', description: 'Продажі за сьогодні' },
    { command: 'cod', description: 'Накладений платіж і невикупи' },
    { command: 'help', description: 'Довідка' },
  ];
  for (const chatId of (await getSettings()).notifications.telegramAdminChatIds) {
    await api('setMyCommands', { commands, scope: { type: 'chat', chat_id: chatId } }).catch(() => undefined);
  }
}
