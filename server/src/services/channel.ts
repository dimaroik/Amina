import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { config } from '../config.js';
import { one, query } from '../db/pool.js';
import { loadImage } from './images.js';
import { money } from './labels.js';
import { escapeHtml as esc, sendTelegram, sendTelegramAlbum, sendTelegramPhoto, telegramEnabled, type TgKeyboard } from './notify/telegram.js';
import { preorderWhenText } from './orders.js';
import { getSettings } from './settings.js';
import { autoNetworks, publishDigestToNetwork, publishToNetwork, type SocialNet } from './social.js';

export type Target = 'telegram' | SocialNet;

export type PostKind = 'new' | 'restock' | 'preorder' | 'incoming' | 'sale' | 'plain';

const HEADERS: Record<PostKind, string> = {
  new: '✨ Новинка',
  restock: '🔁 Знову в наявності',
  preorder: '⏳ Передзамовлення',
  incoming: '🚚 Уже в дорозі',
  sale: '🏷 Знижка',
  plain: '',
};

const staticDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../client/dist/client/browser');

export async function channelReady(): Promise<boolean> {
  return telegramEnabled() && Boolean((await getSettings()).channel.chatId);
}

/** Where automatic posts and the weekly digest go: the Telegram channel and the switched-on networks. */
export async function autoTargets(): Promise<Target[]> {
  const tg = (await getSettings()).channel.telegramAuto && (await channelReady());
  return [...(tg ? (['telegram'] as Target[]) : []), ...(await autoNetworks())];
}

/** Photo bytes for an image URL of the store (uploaded, bundled demo asset, or external). */
export async function imageBytes(url: string): Promise<Buffer | null> {
  try {
    const id = url.match(/^\/api\/images\/([0-9a-f-]{36})/i)?.[1];
    if (id) return (await loadImage(id))?.data ?? null;
    if (url.startsWith('/')) {
      const file = path.resolve(staticDir, `.${url}`);
      return file.startsWith(staticDir) ? await readFile(file) : null;
    }
    if (/^https:\/\//.test(url)) {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    }
  } catch {
    /* fall through to a text post */
  }
  return null;
}

/** Telegram wants JPEG/PNG photos; uploads are WebP and demo images SVG, so everything is converted. */
async function toJpeg(buf: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(buf, { density: 200 }).flatten({ background: '#ffffff' }).resize({ width: 1280, height: 1600, fit: 'inside', withoutEnlargement: false }).jpeg({ quality: 86 }).toBuffer();
  } catch {
    return null;
  }
}

/** What kind of post fits the product right now (used when the admin does not pick one). */
export async function suggestKind(productId: number): Promise<PostKind> {
  const row = await one<{ stock: number; preorder: boolean; incoming: boolean; posts: number; sale: boolean }>(
    `SELECT COALESCE((SELECT SUM(stock) FROM product_variants WHERE product_id = p.id), 0)::int AS stock,
       EXISTS (SELECT 1 FROM variant_preorder vp JOIN product_variants v ON v.id = vp.variant_id WHERE v.product_id = p.id AND vp.available > 0) AS preorder,
       EXISTS (SELECT 1 FROM variant_incoming vi JOIN product_variants v ON v.id = vi.variant_id WHERE v.product_id = p.id) AS incoming,
       (SELECT COUNT(*)::int FROM telegram_posts WHERE product_id = p.id) AS posts,
       p.old_price IS NOT NULL AND p.old_price > p.price AS sale
     FROM products p WHERE p.id = $1`,
    [productId],
  );
  if (!row) return 'plain';
  if (row.stock <= 0) return row.preorder ? 'preorder' : row.incoming ? 'incoming' : 'plain';
  if (!row.posts) return 'new';
  // «back in stock» is for deliveries; a repeated post of an available item gets no badge
  return row.sale ? 'sale' : 'plain';
}

const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];
const sizeRank = (s: string) => {
  const i = SIZE_ORDER.indexOf(s.toUpperCase());
  return i >= 0 ? i : 100 + (Number.parseFloat(s) || 0);
};

export interface PostParts {
  header: string;
  name: string;
  price: number;
  oldPrice: number | null;
  discount: number;
  description: string;
  sizes: string[];
  colors: string[];
  composition: string;
  slug: string;
}

/** What a post about a product says, independent of the network. */
export async function postParts(productId: number, kind: PostKind): Promise<PostParts | null> {
  const p = await one(
    `SELECT p.id, p.name, p.slug, p.price, p.old_price, p.description, p.composition,
       COALESCE((SELECT array_agg(size ORDER BY ord) FROM (
         SELECT v.size, MIN(v.sort_order) AS ord FROM product_variants v
         LEFT JOIN variant_preorder vp ON vp.variant_id = v.id LEFT JOIN variant_incoming vi ON vi.variant_id = v.id
         WHERE v.product_id = p.id AND v.size <> '' AND (v.stock > 0 OR ($2 AND COALESCE(vp.available, 0) > 0) OR ($3 AND vi.variant_id IS NOT NULL))
         GROUP BY v.size) s), '{}') AS sizes,
       COALESCE((SELECT array_agg(DISTINCT color) FROM product_variants WHERE product_id = p.id AND color <> ''), '{}') AS colors,
       (SELECT MIN(eta) FROM variant_incoming vi JOIN product_variants v ON v.id = vi.variant_id WHERE v.product_id = p.id) AS eta
     FROM products p WHERE p.id = $1`,
    [productId, kind === 'preorder', kind === 'incoming'],
  );
  if (!p) return null;
  const discount = p.old_price && p.old_price > p.price ? Math.round((1 - p.price / p.old_price) * 100) : 0;
  let header = HEADERS[kind];
  if ((kind === 'preorder' || kind === 'incoming') && p.eta) header += ` · ${preorderWhenText(p.eta)}`;
  return {
    header,
    name: p.name,
    price: Number(p.price),
    oldPrice: discount ? Number(p.old_price) : null,
    discount,
    description: String(p.description ?? '').trim(),
    sizes: [...(p.sizes as string[])].sort((a, b) => sizeRank(a) - sizeRank(b) || a.localeCompare(b)),
    colors: p.colors as string[],
    composition: String(p.composition ?? ''),
    slug: p.slug,
  };
}

/** Trims a description to fit next to the rest of the post. */
export function fitText(text: string, room: number): string {
  if (text.length <= room) return text;
  return room > 80 ? `${text.slice(0, room - 1).replace(/\s+\S*$/, '')}…` : '';
}

/** Caption (Telegram allows 1024 characters under a photo). */
async function caption(productId: number, kind: PostKind): Promise<{ html: string; slug: string } | null> {
  const d = await postParts(productId, kind);
  if (!d) return null;
  const price = `<b>${money(d.price)}</b>${d.discount ? `  <s>${money(d.oldPrice!)}</s>  −${d.discount}%` : ''}`;
  const head = [d.header ? `<i>${esc(d.header)}</i>` : '', `<b>${esc(d.name)}</b>`, price].filter(Boolean).join('\n');
  const facts = [
    d.sizes.length ? `Розміри: ${esc(d.sizes.join(' · '))}` : '',
    d.colors.length ? `Кольори: ${esc(d.colors.join(', '))}` : '',
    d.composition ? `Склад: ${esc(d.composition)}` : '',
  ].filter(Boolean).join('\n');
  // leave room for the «buy» link that albums carry in the caption (limit 1024)
  const desc = fitText(d.description, 920 - head.length - facts.length - 4);
  return { html: [head, desc ? esc(desc) : '', facts].filter(Boolean).join('\n\n'), slug: d.slug };
}

/** Up to `max` photos of a product as JPEG (skipping any that fail to load). */
async function productPhotos(productId: number, max: number): Promise<Buffer[]> {
  const imgs = await query<{ url: string }>('SELECT url FROM product_images WHERE product_id = $1 ORDER BY sort_order, id LIMIT $2', [productId, max]);
  const out: Buffer[] = [];
  for (const { url } of imgs) {
    const raw = await imageBytes(url);
    const jpg = raw ? await toJpeg(raw) : null;
    if (jpg) out.push(jpg);
  }
  return out;
}

/**
 * Publishes a product to the store's channel: one photo with a «buy» button, or — when the product
 * has several photos and albums are on — an album of up to 4 with the link in the caption.
 */
export async function postProduct(productId: number, kind?: PostKind): Promise<{ messageId: number; kind: PostKind }> {
  const s = await getSettings();
  if (!telegramEnabled()) throw new Error('Telegram-бот не підключено (TELEGRAM_BOT_TOKEN)');
  if (!s.channel.chatId) throw new Error('Вкажіть канал у Налаштування → Telegram');
  const k = kind ?? (await suggestKind(productId));
  const c = await caption(productId, k);
  if (!c) throw new Error('Товар не знайдено');
  const url = `${config.publicUrl}/product/${c.slug}`;
  const linkable = config.publicUrl.startsWith('https://');
  const buttonText = s.channel.buttonText || 'Замовити на сайті';
  const photos = await productPhotos(productId, s.channel.album ? 4 : 1);
  let msg: { message_id: number };
  if (photos.length >= 2) {
    const link = linkable ? `\n\n<a href="${esc(url)}">🛍 ${esc(buttonText)} →</a>` : '';
    msg = await sendTelegramAlbum(s.channel.chatId, photos, `${c.html}${link}`);
  } else {
    const keyboard: TgKeyboard | undefined = linkable ? [[{ text: buttonText, url }]] : undefined;
    msg = photos[0] ? await sendTelegramPhoto(s.channel.chatId, photos[0], c.html, keyboard) : await sendTelegram(s.channel.chatId, c.html, keyboard);
  }
  await query('INSERT INTO telegram_posts(product_id, chat_id, message_id, kind) VALUES ($1, $2, $3, $4)', [productId, s.channel.chatId, msg.message_id, k]);
  return { messageId: msg.message_id, kind: k };
}

// ---------- time (the shop lives in Kyiv time) ----------

const TZ = 'Europe/Kyiv';

function kyivParts(d: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday!) + 1;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hhmm: `${parts.hour}:${parts.minute}`, weekday };
}

/** The UTC instant of a Kyiv wall-clock time (handles summer/winter time). */
function kyivToUtc(date: string, hhmm: string): Date {
  const guess = new Date(`${date}T${hhmm}:00Z`);
  const shown = kyivParts(guess);
  const diff = new Date(`${shown.date}T${shown.hhmm}:00Z`).getTime() - guess.getTime();
  return new Date(guess.getTime() - diff);
}

/** Next moment the Kyiv clock shows `hhmm` (today if still ahead, otherwise tomorrow). */
export function nextKyivTime(hhmm: string, from = new Date()): Date {
  const today = kyivToUtc(kyivParts(from).date, hhmm);
  if (today.getTime() > from.getTime()) return today;
  return kyivToUtc(kyivParts(new Date(from.getTime() + 24 * 3600_000)).date, hhmm);
}

// ---------- queue ----------

/**
 * Queues automatic posts: right away, or at the hour set in Налаштування → Telegram. A product is
 * skipped when it is already waiting in the queue or was posted in the last two days.
 */
export async function scheduleAuto(items: { productId: number; kind: PostKind }[], delayMin = 0): Promise<number> {
  if (!items.length) return 0;
  const targets = await autoTargets();
  if (!targets.length) return 0;
  const at = await autoRunAt(delayMin);
  let queued = 0;
  for (const it of items.slice(0, 15)) {
    for (const target of targets) {
      // a discount is news even right after an arrival post; other kinds wait two days after any post
      const busy = await one(
        `SELECT 1 FROM telegram_posts WHERE product_id = $1 AND target = $3 AND created_at > now() - interval '2 days' AND ($2 <> 'sale' OR kind = 'sale')
         UNION ALL SELECT 1 FROM channel_queue WHERE product_id = $1 AND target = $3 AND status = 'pending' LIMIT 1`,
        [it.productId, it.kind, target],
      );
      if (busy) continue;
      await query('INSERT INTO channel_queue(product_id, kind, run_at, source, target) VALUES ($1, $2, $3, $4, $5)', [it.productId, it.kind, at, 'auto', target]);
      queued++;
    }
  }
  if (queued && at.getTime() <= Date.now()) void processQueue();
  return queued;
}

/** When an automatic post goes out: after the delay, then at the configured hour if there is one. */
async function autoRunAt(delayMin: number): Promise<Date> {
  const s = (await getSettings()).channel;
  const base = new Date(Date.now() + delayMin * 60_000);
  return s.autoTime ? nextKyivTime(s.autoTime, base) : base;
}

export interface ProductPostState {
  ready: boolean;
  stock: number;
}

/** On sale, in stock and with a photo — what a post about a product needs. */
export async function productPostState(id: number): Promise<ProductPostState> {
  const r = await one<{ active: boolean; stock: number; photo: boolean }>(
    `SELECT p.is_active AS active,
       COALESCE((SELECT SUM(stock) FROM product_variants WHERE product_id = p.id), 0)::int AS stock,
       EXISTS (SELECT 1 FROM product_images WHERE product_id = p.id) AS photo
     FROM products p WHERE p.id = $1`,
    [id],
  );
  return { ready: Boolean(r && r.active && r.photo && r.stock > 0), stock: r?.stock ?? 0 };
}

/**
 * After the admin saves a product by hand: a fresh product that just became ready → «Новинка»;
 * stock raised from 0 → «Знову в наявності». The post waits `manualDelay` minutes, and every
 * further save pushes it back, so it goes out with the final photos and text.
 */
export async function onProductSaved(id: number, before: ProductPostState | null): Promise<void> {
  const s = (await getSettings()).channel;
  const now = await productPostState(id);
  const waiting = await query<{ id: number }>(
    "SELECT id FROM channel_queue WHERE product_id = $1 AND status = 'pending' AND source = 'auto' AND kind IN ('new', 'restock')",
    [id],
  );
  if (waiting.length) {
    if (!now.ready) {
      await query("UPDATE channel_queue SET status = 'cancelled', error = 'товар прихований, без фото або закінчився' WHERE id = ANY($1)", [waiting.map((w) => w.id)]);
    } else {
      await query('UPDATE channel_queue SET run_at = GREATEST(run_at, $2) WHERE id = ANY($1)', [waiting.map((w) => w.id), await autoRunAt(s.manualDelay)]);
    }
    return;
  }
  if (!now.ready || before?.ready) return;
  // became ready just now: a product nobody has heard of yet is news, one that ran out is back
  const fresh = await one(
    `SELECT 1 FROM products p WHERE p.id = $1 AND p.created_at > now() - interval '14 days'
       AND NOT EXISTS (SELECT 1 FROM telegram_posts WHERE product_id = p.id)
       AND NOT EXISTS (SELECT 1 FROM channel_queue WHERE product_id = p.id AND status IN ('pending', 'sent'))`,
    [id],
  );
  if (fresh) {
    if (s.postOnCreate) await scheduleAuto([{ productId: id, kind: 'new' }], s.manualDelay);
  } else if (before && before.stock === 0 && s.postOnRestock) {
    await scheduleAuto([{ productId: id, kind: 'restock' }], s.manualDelay);
  }
}

/** A post the admin scheduled by hand for a specific time. */
export async function scheduleManual(productId: number, kind: PostKind, at: Date, target: Target = 'telegram') {
  return one<{ id: number; run_at: string }>(
    'INSERT INTO channel_queue(product_id, kind, run_at, source, target) VALUES ($1, $2, $3, $4, $5) RETURNING id, run_at',
    [productId, kind, at, 'manual', target],
  );
}

/** Publishes one product to one place right now. */
export async function publishTo(target: Target, productId: number, kind: PostKind): Promise<void> {
  if (target === 'telegram') await postProduct(productId, kind);
  else await publishToNetwork(target, productId, kind);
}

let processing = false;

/** Sends due posts one by one (Telegram allows ~20 channel messages a minute). Failed ones are retried twice. */
export async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    const due = await query<{ id: number; product_id: number | null; kind: string; attempts: number; target: Target }>(
      `SELECT q.id, q.product_id, q.kind, q.attempts, q.target FROM channel_queue q
       WHERE q.status = 'pending' AND q.run_at <= now() ORDER BY q.run_at, q.id LIMIT 15`,
    );
    for (const q of due) {
      // take the row for 10 minutes first, so a second server instance (during a deploy) skips it
      const lease = await one(
        "UPDATE channel_queue SET run_at = now() + interval '10 minutes' WHERE id = $1 AND status = 'pending' AND run_at <= now() RETURNING id",
        [q.id],
      );
      if (!lease) continue;
      try {
        const active = q.product_id ? await one('SELECT 1 FROM products WHERE id = $1 AND is_active', [q.product_id]) : null;
        if (!active) {
          await query("UPDATE channel_queue SET status = 'cancelled', error = 'товар прихований або видалений' WHERE id = $1", [q.id]);
          continue;
        }
        // «новинка», «знову в наявності» and «знижка» are about things to buy now
        if (['new', 'restock', 'sale'].includes(q.kind) && (await productPostState(q.product_id!)).stock === 0) {
          await query("UPDATE channel_queue SET status = 'cancelled', error = 'товар закінчився' WHERE id = $1", [q.id]);
          continue;
        }
        await publishTo(q.target, q.product_id!, q.kind as PostKind);
        await query("UPDATE channel_queue SET status = 'sent', sent_at = now() WHERE id = $1", [q.id]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[channel queue]', msg);
        await query(
          `UPDATE channel_queue SET attempts = attempts + 1, error = $2,
             status = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE 'pending' END, run_at = now() + interval '10 minutes'
           WHERE id = $1`,
          [q.id, msg.slice(0, 500)],
        );
      }
      await new Promise((r) => setTimeout(r, 3500));
    }
  } finally {
    processing = false;
  }
}

export function pendingPosts(productId?: number) {
  return query<{ id: number; product_id: number; name: string; kind: string; run_at: string; source: string; attempts: number; error: string | null; target: Target }>(
    `SELECT q.id, q.product_id, p.name, q.kind, q.run_at, q.source, q.attempts, q.error, q.target
     FROM channel_queue q JOIN products p ON p.id = q.product_id
     WHERE q.status = 'pending' AND ($1::int IS NULL OR q.product_id = $1) ORDER BY q.run_at LIMIT 50`,
    [productId ?? null],
  );
}

export async function cancelPost(id: number): Promise<boolean> {
  const r = await query("UPDATE channel_queue SET status = 'cancelled' WHERE id = $1 AND status = 'pending' RETURNING id", [id]);
  return r.length > 0;
}

// ---------- weekly digest ----------

/** New arrivals of the last 7 days that can be bought (newest first, up to 10). */
export function digestProducts() {
  return query<{ id: number; name: string; slug: string; price: number; old_price: number | null; image: string | null }>(
    `SELECT p.id, p.name, p.slug, p.price, p.old_price,
       (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image
     FROM products p
     WHERE p.is_active
       AND COALESCE((SELECT SUM(stock) FROM product_variants WHERE product_id = p.id), 0) > 0
       AND (p.created_at >= now() - interval '7 days'
            OR EXISTS (SELECT 1 FROM telegram_posts t WHERE t.product_id = p.id AND t.kind = 'new' AND t.created_at >= now() - interval '7 days'))
     ORDER BY p.created_at DESC LIMIT 10`,
  );
}

/** «Новинки тижня»: an album of the first photos with a numbered list of links. */
async function telegramDigest(list: Awaited<ReturnType<typeof digestProducts>>): Promise<void> {
  const s = await getSettings();
  const linkable = config.publicUrl.startsWith('https://');
  const rows = list.map((p, i) => {
    const name = linkable ? `<a href="${esc(`${config.publicUrl}/product/${p.slug}`)}">${esc(p.name)}</a>` : esc(p.name);
    const sale = p.old_price && p.old_price > p.price ? ` <s>${money(Number(p.old_price))}</s>` : '';
    return `${i + 1}. ${name} — ${money(Number(p.price))}${sale}`;
  });
  const more = linkable ? `\n\n<a href="${esc(`${config.publicUrl}/catalog`)}">Увесь каталог →</a>` : '';
  const text = `<b>✨ Новинки тижня</b>\n\n${rows.join('\n')}${more}`;
  const photos: Buffer[] = [];
  for (const p of list) {
    const raw = p.image ? await imageBytes(p.image) : null;
    const jpg = raw ? await toJpeg(raw) : null;
    if (jpg) photos.push(jpg);
  }
  if (photos.length >= 2) await sendTelegramAlbum(s.channel.chatId, photos.slice(0, 10), text);
  else if (photos[0]) await sendTelegramPhoto(s.channel.chatId, photos[0], text);
  else await sendTelegram(s.channel.chatId, text);
}

/** «Новинки тижня» to the Telegram channel and every connected network that takes automatic posts. */
export async function postDigest(): Promise<{ count: number; posted: Target[]; errors: string[] } | null> {
  const targets = await autoTargets();
  if (!targets.length) throw new Error('Не підключено жодного каналу чи соцмережі (або автопублікацію вимкнено)');
  const list = await digestProducts();
  if (!list.length) return null;
  const posted: Target[] = [];
  const errors: string[] = [];
  for (const t of targets) {
    try {
      if (t === 'telegram') await telegramDigest(list);
      else await publishDigestToNetwork(t, list);
      posted.push(t);
    } catch (err) {
      errors.push(`${t}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await query(
    `INSERT INTO app_state(key, value, updated_at) VALUES ('last_digest', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify({ date: kyivParts(new Date()).date, count: list.length, posted })],
  );
  if (!posted.length) throw new Error(errors.join('; '));
  return { count: list.length, posted, errors };
}

let digesting = false;

/** Posts the digest once on the chosen weekday after the chosen time (also if the server woke up late that day). */
async function maybeDigest(): Promise<void> {
  if (digesting) return;
  const s = (await getSettings()).channel;
  if (!s.digestEnabled || !(await autoTargets()).length) return;
  const now = kyivParts(new Date());
  if (now.weekday !== s.digestDay || now.hhmm < s.digestTime) return;
  // claim the day before posting: Instagram carousels take longer than the 1-minute tick,
  // and the day must not be posted again by the next tick or by another instance
  const claimed = await one(
    `INSERT INTO app_state(key, value, updated_at) VALUES ('last_digest', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
       WHERE app_state.value->>'date' IS DISTINCT FROM EXCLUDED.value->>'date'
     RETURNING key`,
    [JSON.stringify({ date: now.date, count: 0 })],
  );
  if (!claimed) return;
  digesting = true;
  try {
    await postDigest();
  } catch (err) {
    console.error('[channel digest]', err instanceof Error ? err.message : err);
  } finally {
    digesting = false;
  }
}

export async function lastDigest() {
  return one<{ value: { date: string; count: number } }>("SELECT value FROM app_state WHERE key = 'last_digest'").then((r) => r?.value ?? null);
}

/** Every minute: due scheduled posts and the weekly digest. Render's free plan sleeps when idle, so posts due during sleep go out on wake-up. */
export function startChannelJob(): void {
  const tick = () => {
    processQueue().catch((err) => console.error('[channel queue]', err));
    maybeDigest().catch((err) => console.error('[channel digest]', err));
  };
  setTimeout(tick, 20_000).unref();
  setInterval(tick, 60_000).unref();
}

export async function lastPost(productId: number) {
  return one<{ created_at: string; kind: string }>('SELECT created_at, kind FROM telegram_posts WHERE product_id = $1 ORDER BY created_at DESC LIMIT 1', [productId]);
}
