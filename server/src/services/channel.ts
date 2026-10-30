import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { config } from '../config.js';
import { one, query } from '../db/pool.js';
import { loadImage } from './images.js';
import { money } from './labels.js';
import { escapeHtml as esc, sendTelegram, sendTelegramPhoto, telegramEnabled, type TgKeyboard } from './notify/telegram.js';
import { preorderWhenText } from './orders.js';
import { getSettings } from './settings.js';

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

/** Photo bytes for an image URL of the store (uploaded, bundled demo asset, or external). */
async function imageBytes(url: string): Promise<Buffer | null> {
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

/** Caption (Telegram allows 1024 characters under a photo). */
async function caption(productId: number, kind: PostKind): Promise<{ html: string; slug: string; image: string | null } | null> {
  const p = await one(
    `SELECT p.id, p.name, p.slug, p.price, p.old_price, p.description, p.composition,
       (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image,
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
  const price = `<b>${money(Number(p.price))}</b>${discount ? `  <s>${money(Number(p.old_price))}</s>  −${discount}%` : ''}`;
  const head = [header ? `<i>${esc(header)}</i>` : '', `<b>${esc(p.name)}</b>`, price].filter(Boolean).join('\n');
  const sizes = [...(p.sizes as string[])].sort((a, b) => sizeRank(a) - sizeRank(b) || a.localeCompare(b));
  const facts = [
    sizes.length ? `Розміри: ${esc(sizes.join(' · '))}` : '',
    p.colors.length ? `Кольори: ${esc(p.colors.join(', '))}` : '',
    p.composition ? `Склад: ${esc(p.composition)}` : '',
  ].filter(Boolean).join('\n');
  let desc = String(p.description ?? '').trim();
  const room = 1000 - head.length - facts.length - 4;
  if (desc.length > room) desc = room > 80 ? `${desc.slice(0, room - 1).replace(/\s+\S*$/, '')}…` : '';
  const lines = [head, desc ? esc(desc) : '', facts].filter(Boolean).join('\n\n');
  return { html: lines, slug: p.slug, image: p.image };
}

/** Publishes a product to the store's channel: first photo, caption and a «buy» button. */
export async function postProduct(productId: number, kind?: PostKind): Promise<{ messageId: number; kind: PostKind }> {
  const s = await getSettings();
  if (!telegramEnabled()) throw new Error('Telegram-бот не підключено (TELEGRAM_BOT_TOKEN)');
  if (!s.channel.chatId) throw new Error('Вкажіть канал у Налаштування → Telegram-канал');
  const k = kind ?? (await suggestKind(productId));
  const c = await caption(productId, k);
  if (!c) throw new Error('Товар не знайдено');
  const url = `${config.publicUrl}/product/${c.slug}`;
  const keyboard: TgKeyboard | undefined = config.publicUrl.startsWith('https://') ? [[{ text: s.channel.buttonText || 'Замовити на сайті', url }]] : undefined;
  const raw = c.image ? await imageBytes(c.image) : null;
  const photo = raw ? await toJpeg(raw) : null;
  const msg = photo ? await sendTelegramPhoto(s.channel.chatId, photo, c.html, keyboard) : await sendTelegram(s.channel.chatId, c.html, keyboard);
  await query('INSERT INTO telegram_posts(product_id, chat_id, message_id, kind) VALUES ($1, $2, $3, $4)', [productId, s.channel.chatId, msg.message_id, k]);
  return { messageId: msg.message_id, kind: k };
}

/** Posts several products one by one (Telegram limits channels to ~20 messages a minute). */
export async function postProducts(ids: number[], kind: (id: number) => Promise<PostKind | null>): Promise<number> {
  if (!(await channelReady())) return 0;
  let posted = 0;
  for (const id of ids.slice(0, 15)) {
    // the same product is not repeated within two days (e.g. announced, then received)
    const recent = await one('SELECT 1 FROM telegram_posts WHERE product_id = $1 AND created_at > now() - interval \'2 days\'', [id]);
    const k = recent ? null : await kind(id);
    if (!k) continue;
    try {
      await postProduct(id, k);
      posted++;
      await new Promise((r) => setTimeout(r, 3500));
    } catch (err) {
      console.error('[channel]', err instanceof Error ? err.message : err);
    }
  }
  return posted;
}

export async function lastPost(productId: number) {
  return one<{ created_at: string; kind: string }>('SELECT created_at, kind FROM telegram_posts WHERE product_id = $1 ORDER BY created_at DESC LIMIT 1', [productId]);
}
