import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import {
  cancelPost,
  channelReady,
  digestProducts,
  lastDigest,
  lastPost,
  pendingPosts,
  postDigest,
  publishTo,
  scheduleManual,
  type Target,
  suggestKind,
  type PostKind,
} from '../../services/channel.js';
import { codSummary, markCodPaid, PHONE_KEY_SQL, phoneKey, setPrepayOnly } from '../../services/cod.js';
import { sendTelegram, telegramEnabled } from '../../services/notify/telegram.js';
import { authUrl, chooseFacebookPage, connectedNetworks, deleteSecret, fbConfigured, getSecret, igConfigured, socialStatus } from '../../services/social.js';
import { addHistory } from '../../services/orders.js';
import { getSettings } from '../../services/settings.js';
import { badRequest, HttpError } from '../../utils/errors.js';

export const adminTelegramCodRouter = Router();

// ---------- cash on delivery ----------

const STATES = ['awaiting', 'collected', 'paid_out', 'refused'] as const;

adminTelegramCodRouter.get('/cod', async (req, res) => {
  const { state } = z.object({ state: z.enum(STATES).optional() }).parse(req.query);
  const where = state === 'refused' ? 'o.refused_at IS NOT NULL' : state ? `o.cod_status = '${state}'` : "(o.cod_status <> 'none' OR o.refused_at IS NOT NULL)";
  const [summary, items, refusers] = await Promise.all([
    codSummary(),
    query(
      `SELECT o.id, o.number, o.status, o.customer_name, o.customer_phone, o.tracking_number, o.np_status, o.cod_amount, o.cod_status,
         o.cod_paid_at, o.refused_at, o.created_at, o.total,
         (SELECT COUNT(*)::int FROM orders x WHERE ${PHONE_KEY_SQL('x.customer_phone')} = ${PHONE_KEY_SQL('o.customer_phone')} AND x.refused_at IS NOT NULL) AS phone_refusals,
         COALESCE(f.prepay_only, false) AS prepay_only
       FROM orders o LEFT JOIN customer_flags f ON f.phone_key = ${PHONE_KEY_SQL('o.customer_phone')}
       WHERE ${where}
       ORDER BY COALESCE(o.refused_at, o.created_at) DESC LIMIT 200`,
    ),
    query(
      `SELECT k.phone_key, k.refusals, k.last_refused, k.phone, k.name, k.orders, COALESCE(f.prepay_only, false) AS prepay_only, COALESCE(f.note, '') AS note, f.phone_key IS NOT NULL AS manual
       FROM (
         SELECT ${PHONE_KEY_SQL('customer_phone')} AS phone_key,
           COUNT(*) FILTER (WHERE refused_at IS NOT NULL)::int AS refusals,
           MAX(refused_at) AS last_refused,
           (array_agg(customer_phone ORDER BY created_at DESC))[1] AS phone,
           (array_agg(customer_name ORDER BY created_at DESC))[1] AS name,
           COUNT(*)::int AS orders
         FROM orders GROUP BY 1
       ) k LEFT JOIN customer_flags f ON f.phone_key = k.phone_key
       WHERE k.refusals > 0 OR f.prepay_only
       ORDER BY k.last_refused DESC NULLS LAST LIMIT 100`,
    ),
  ]);
  res.json({ summary, items, refusers, blockAfter: (await getSettings()).payment.codBlockAfterRefusals });
});

adminTelegramCodRouter.post('/cod/:id/paid', async (req, res) => {
  if (!(await markCodPaid(Number(req.params.id), req.user!.name || req.user!.email))) throw badRequest('Для цього замовлення немає очікуваного накладеного платежу');
  res.json({ ok: true });
});

/** Manual mark for parcels refused outside Nova Poshta tracking (or before it caught up). */
adminTelegramCodRouter.post('/cod/:id/refused', async (req, res) => {
  const id = Number(req.params.id);
  const row = await query(
    `UPDATE orders SET refused_at = now(), cod_status = CASE WHEN cod_status IN ('awaiting', 'collected') THEN 'refused' ELSE cod_status END
     WHERE id = $1 AND refused_at IS NULL RETURNING id`,
    [id],
  );
  if (!row.length) throw badRequest('Відмову вже зафіксовано');
  await addHistory(id, 'tracking', 'Відмова від посилки (позначено вручну)', req.user!.name || req.user!.email);
  res.json({ ok: true });
});

adminTelegramCodRouter.put('/customer-flags', async (req, res) => {
  const b = z.object({ phone: z.string().trim().min(9).max(30), prepay_only: z.boolean(), note: z.string().max(300).default('') }).parse(req.body);
  if (phoneKey(b.phone).length < 9) throw badRequest('Невірний номер');
  await setPrepayOnly(b.phone, b.prepay_only, b.note);
  res.json({ ok: true });
});

// ---------- Telegram channel ----------

adminTelegramCodRouter.get('/products/:id/telegram', async (req, res) => {
  const id = Number(req.params.id);
  res.json({
    ready: await channelReady(),
    networks: await connectedNetworks(),
    last: await lastPost(id),
    suggested: await suggestKind(id),
    scheduled: await pendingPosts(id),
  });
});

adminTelegramCodRouter.post('/products/:id/telegram', async (req, res) => {
  const { kind, at, targets } = z
    .object({
      kind: z.enum(['new', 'restock', 'preorder', 'incoming', 'sale', 'plain']).optional(),
      at: z.string().datetime({ offset: true }).optional(),
      targets: z.array(z.enum(['telegram', 'instagram', 'facebook'])).min(1).default(['telegram']),
    })
    .parse(req.body ?? {});
  const id = Number(req.params.id);
  const k = (kind ?? (await suggestKind(id))) as PostKind;
  const available: Target[] = [...((await channelReady()) ? (['telegram'] as Target[]) : []), ...(await connectedNetworks())];
  const missing = targets.filter((t) => !available.includes(t));
  if (missing.length) throw badRequest(`Не підключено: ${missing.join(', ')}`);
  if (at) {
    const when = new Date(at);
    if (when.getTime() < Date.now() - 60_000) throw badRequest('Цей час уже минув');
    const scheduled = [];
    for (const t of targets) scheduled.push(await scheduleManual(id, k, when, t));
    return res.status(201).json({ scheduled: scheduled[0], count: scheduled.length });
  }
  const done: Target[] = [];
  const errors: string[] = [];
  for (const t of targets) {
    try {
      await publishTo(t, id, k);
      done.push(t);
    } catch (err) {
      errors.push(`${NET_NAMES[t]}: ${t === 'telegram' ? friendlyTelegramError(err) : err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!done.length) throw new HttpError(502, errors.join('; '));
  res.json({ kind: k, posted: done, errors });
});

adminTelegramCodRouter.get('/channel/queue', async (_req, res) => {
  res.json({ pending: await pendingPosts(), digest: { products: await digestProducts(), last: await lastDigest() } });
});

adminTelegramCodRouter.delete('/channel/queue/:id', async (req, res) => {
  if (!(await cancelPost(Number(req.params.id)))) throw badRequest('Пост уже опубліковано або скасовано');
  res.json({ ok: true });
});

adminTelegramCodRouter.post('/channel/digest', async (_req, res) => {
  let r;
  try {
    r = await postDigest();
  } catch (err) {
    throw new HttpError(502, friendlyTelegramError(err));
  }
  if (!r) throw badRequest('За останні 7 днів немає нових товарів у наявності — добірку не опубліковано');
  res.json(r);
});

// ---------- Instagram / Facebook ----------

const NET_NAMES: Record<Target, string> = { telegram: 'Telegram', instagram: 'Instagram', facebook: 'Facebook' };

adminTelegramCodRouter.get('/social', async (_req, res) => {
  res.json(await socialStatus());
});

adminTelegramCodRouter.get('/social/connect/:net', async (req, res) => {
  let net = z.enum(['instagram', 'facebook']).parse(req.params.net);
  // new Meta apps connect Instagram through Facebook Login for Business (the Instagram linked to the Page)
  if (net === 'instagram' && !igConfigured() && fbConfigured()) net = 'facebook';
  if (net === 'instagram' ? !igConfigured() : !fbConfigured()) {
    throw badRequest('Додайте META_APP_ID і META_APP_SECRET на Render');
  }
  res.json({ url: authUrl(net, req.user!.id) });
});

adminTelegramCodRouter.post('/social/facebook/page', async (req, res) => {
  const { pageId } = z.object({ pageId: z.string().min(1).max(40) }).parse(req.body);
  try {
    res.json(await chooseFacebookPage(pageId));
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : 'Не вдалося');
  }
});

adminTelegramCodRouter.delete('/social/:net', async (req, res) => {
  const net = z.enum(['instagram', 'facebook']).parse(req.params.net);
  await deleteSecret(net);
  if (net === 'facebook') {
    await deleteSecret('facebook_pages');
    // Instagram connected through this Page stops working with it
    if ((await getSecret<{ via?: string }>('instagram'))?.via === 'facebook') await deleteSecret('instagram');
  }
  res.json({ ok: true });
});

adminTelegramCodRouter.post('/channel/test', async (req, res) => {
  const { chatId } = z.object({ chatId: z.string().trim().min(2).max(100) }).parse(req.body);
  if (!telegramEnabled()) throw badRequest('Telegram-бот не підключено (TELEGRAM_BOT_TOKEN на Render)');
  try {
    await sendTelegram(chatId, '✅ Amina: бот може публікувати в цей канал. Це тестове повідомлення — його можна видалити.');
  } catch (err) {
    throw new HttpError(502, friendlyTelegramError(err));
  }
  res.json({ ok: true });
});

function friendlyTelegramError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/chat not found/i.test(msg)) return 'Канал не знайдено. Перевірте @назву або ID і що бот доданий у канал.';
  if (/not enough rights|administrator|not a member|kicked/i.test(msg)) return 'Бот не має права публікувати: додайте його адміністратором каналу з дозволом «Публікація повідомлень».';
  return msg.replace(/^Telegram:\s*/, '');
}
