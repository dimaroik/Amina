import jwt from 'jsonwebtoken';
import sharp from 'sharp';
import { config } from '../config.js';
import { one, query } from '../db/pool.js';
import { fitText, imageBytes, postParts, type PostKind } from './channel.js';
import { money } from './labels.js';
import { getSettings } from './settings.js';

export type SocialNet = 'instagram' | 'facebook';

export interface InstagramAccount {
  userId: string;
  username: string;
  token: string;
  /** 'instagram' — Instagram Login (graph.instagram.com, token refreshed weekly);
   *  'facebook' — Facebook Login for Business: the account linked to the connected Page, published with the Page token */
  via?: 'instagram' | 'facebook';
  /** long-lived tokens live 60 days and are refreshed weekly */
  expiresAt: string;
  refreshedAt: string;
}

export interface FacebookAccount {
  pageId: string;
  pageName: string;
  pageToken: string;
}

export const igConfigured = () => Boolean(config.meta.igAppId && config.meta.igAppSecret);
export const fbConfigured = () => Boolean(config.meta.appId && config.meta.appSecret);

// ---------- secrets ----------

export async function getSecret<T>(key: string): Promise<T | null> {
  return (await one<{ value: T }>('SELECT value FROM secrets WHERE key = $1', [key]))?.value ?? null;
}

export async function setSecret(key: string, value: unknown): Promise<void> {
  await query(
    `INSERT INTO secrets(key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

export async function deleteSecret(key: string): Promise<void> {
  await query('DELETE FROM secrets WHERE key = $1', [key]);
}

// ---------- HTTP ----------

export class MetaError extends Error {}

async function meta<T = any>(url: string, params: Record<string, string> = {}, method: 'GET' | 'POST' = 'GET'): Promise<T> {
  const u = new URL(url);
  let body: URLSearchParams | undefined;
  if (method === 'GET') for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  else body = new URLSearchParams(params);
  const res = await fetch(u, { method, body, signal: AbortSignal.timeout(30_000) });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || json.error) {
    const e = json.error;
    const msg = typeof e === 'string' ? `${e}: ${json.error_description ?? json.error_message ?? ''}` : (e?.error_user_msg ?? e?.message ?? json.error_message ?? `HTTP ${res.status}`);
    throw new MetaError(msg);
  }
  return json as T;
}

// ---------- connecting accounts (OAuth) ----------

export const redirectUri = (net: SocialNet) => `${config.publicUrl}/api/social/callback/${net}`;

/** Short-lived signed state so the callback knows the login was started from our admin panel. */
function state(net: SocialNet, adminId: number): string {
  return jwt.sign({ net, uid: adminId }, config.jwtSecret, { expiresIn: '20m' });
}

export function checkState(net: SocialNet, value: string): boolean {
  try {
    return (jwt.verify(value, config.jwtSecret) as { net: string }).net === net;
  } catch {
    return false;
  }
}

/** Page posting plus Instagram publishing through the Instagram account linked to the Page. */
const FB_SCOPES = 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management';

export function authUrl(net: SocialNet, adminId: number): string {
  if (net === 'instagram') {
    const u = new URL('https://www.instagram.com/oauth/authorize');
    u.searchParams.set('client_id', config.meta.igAppId);
    u.searchParams.set('redirect_uri', redirectUri('instagram'));
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'instagram_business_basic,instagram_business_content_publish');
    u.searchParams.set('state', state('instagram', adminId));
    return u.toString();
  }
  const u = new URL('https://www.facebook.com/dialog/oauth');
  u.searchParams.set('client_id', config.meta.appId);
  u.searchParams.set('redirect_uri', redirectUri('facebook'));
  if (config.meta.loginConfigId) {
    // Facebook Login for Business: permissions and assets come from the configuration made in the app dashboard
    u.searchParams.set('config_id', config.meta.loginConfigId);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('override_default_response_type', 'true');
  } else {
    u.searchParams.set('scope', FB_SCOPES);
  }
  u.searchParams.set('state', state('facebook', adminId));
  return u.toString();
}

/** Code → short-lived token → 60-day token → account name. */
export async function connectInstagram(code: string): Promise<InstagramAccount> {
  const short = await meta<{ access_token: string; user_id: number | string }>(
    `${config.meta.igApiUrl}/oauth/access_token`,
    { client_id: config.meta.igAppId, client_secret: config.meta.igAppSecret, grant_type: 'authorization_code', redirect_uri: redirectUri('instagram'), code },
    'POST',
  );
  const long = await meta<{ access_token: string; expires_in: number }>(`${config.meta.igGraphUrl}/access_token`, {
    grant_type: 'ig_exchange_token',
    client_secret: config.meta.igAppSecret,
    access_token: short.access_token,
  });
  const me = await meta<{ user_id?: string; id: string; username: string }>(`${config.meta.igGraphUrl}/me`, {
    fields: 'user_id,username',
    access_token: long.access_token,
  });
  const acc: InstagramAccount = {
    userId: String(me.user_id ?? me.id ?? short.user_id),
    username: me.username,
    token: long.access_token,
    expiresAt: new Date(Date.now() + long.expires_in * 1000).toISOString(),
    refreshedAt: new Date().toISOString(),
  };
  await setSecret('instagram', acc);
  return acc;
}

/** Code → user token → long-lived user token → Page tokens (these don't expire). One Page connects at once; several wait for a choice. */
export async function connectFacebook(code: string): Promise<{ connected: FacebookAccount | null; pages: { id: string; name: string }[] }> {
  const short = await meta<{ access_token: string }>(`${config.meta.graphUrl}/oauth/access_token`, {
    client_id: config.meta.appId,
    client_secret: config.meta.appSecret,
    redirect_uri: redirectUri('facebook'),
    code,
  });
  const long = await meta<{ access_token: string }>(`${config.meta.graphUrl}/oauth/access_token`, {
    grant_type: 'fb_exchange_token',
    client_id: config.meta.appId,
    client_secret: config.meta.appSecret,
    fb_exchange_token: short.access_token,
  });
  const pages = await meta<{ data: PageRow[] }>(`${config.meta.graphUrl}/me/accounts`, {
    fields: 'id,name,access_token,instagram_business_account{id,username}',
    limit: '50',
    access_token: long.access_token,
  });
  if (!pages.data.length) throw new MetaError('Не знайдено жодної сторінки Facebook, до якої ви дали доступ');
  // the Page with a linked Instagram account is almost always the shop's one
  const withIg = pages.data.filter((p) => p.instagram_business_account);
  if (pages.data.length === 1 || withIg.length === 1) {
    const acc = await usePage(withIg[0] ?? pages.data[0]!);
    await deleteSecret('facebook_pages');
    return { connected: acc, pages: [] };
  }
  await setSecret('facebook_pages', pages.data);
  return { connected: null, pages: pages.data.map(({ id, name }) => ({ id, name })) };
}

interface PageRow {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
}

/** Saves the Page and, when an Instagram account is linked to it, connects Instagram through the same Page token. */
async function usePage(p: PageRow): Promise<FacebookAccount> {
  const acc = { pageId: p.id, pageName: p.name, pageToken: p.access_token };
  await setSecret('facebook', acc);
  const ig = p.instagram_business_account;
  const current = await getSecret<InstagramAccount>('instagram');
  if (ig && current?.via !== 'instagram') {
    let username = ig.username ?? '';
    if (!username) {
      username = (await meta<{ username?: string }>(`${config.meta.graphUrl}/${ig.id}`, { fields: 'username', access_token: p.access_token }).catch(() => ({ username: '' }))).username ?? '';
    }
    await setSecret('instagram', {
      userId: ig.id,
      username,
      token: p.access_token,
      via: 'facebook',
      expiresAt: '',
      refreshedAt: new Date().toISOString(),
    } satisfies InstagramAccount);
  }
  return acc;
}

export async function chooseFacebookPage(pageId: string): Promise<FacebookAccount> {
  const pages = (await getSecret<PageRow[]>('facebook_pages')) ?? [];
  const p = pages.find((x) => x.id === pageId);
  if (!p) throw new MetaError('Сторінку не знайдено — підключіть Facebook ще раз');
  const acc = await usePage(p);
  await deleteSecret('facebook_pages');
  return acc;
}

/** Instagram tokens expire after 60 days unless refreshed; refreshing weekly keeps them alive. */
export async function refreshInstagramToken(force = false): Promise<void> {
  const acc = await getSecret<InstagramAccount>('instagram');
  // Page tokens from Facebook Login don't expire
  if (!acc || acc.via === 'facebook') return;
  if (!force && Date.now() - new Date(acc.refreshedAt).getTime() < 7 * 86_400_000) return;
  const r = await meta<{ access_token: string; expires_in: number }>(`${config.meta.igGraphUrl}/refresh_access_token`, {
    grant_type: 'ig_refresh_token',
    access_token: acc.token,
  });
  await setSecret('instagram', { ...acc, token: r.access_token, expiresAt: new Date(Date.now() + r.expires_in * 1000).toISOString(), refreshedAt: new Date().toISOString() });
}

export async function socialStatus() {
  const [ig, fb, pages] = await Promise.all([
    getSecret<InstagramAccount>('instagram'),
    getSecret<FacebookAccount>('facebook'),
    getSecret<{ id: string; name: string }[]>('facebook_pages'),
  ]);
  return {
    instagram: {
      configured: igConfigured(),
      connected: ig ? { username: ig.username, expiresAt: ig.expiresAt, via: ig.via ?? 'instagram' } : null,
      redirectUri: redirectUri('instagram'),
    },
    facebook: {
      configured: fbConfigured(),
      businessLogin: Boolean(config.meta.loginConfigId),
      connected: fb ? { pageName: fb.pageName, pageId: fb.pageId } : null,
      pending: (pages ?? []).map(({ id, name }) => ({ id, name })),
      redirectUri: redirectUri('facebook'),
    },
    https: config.publicUrl.startsWith('https://'),
  };
}

/** Networks that receive automatic posts right now (connected and switched on). */
export async function autoNetworks(): Promise<SocialNet[]> {
  const s = (await getSettings()).social;
  const out: SocialNet[] = [];
  if (s.instagram && (await getSecret('instagram'))) out.push('instagram');
  if (s.facebook && (await getSecret('facebook'))) out.push('facebook');
  return out;
}

export async function connectedNetworks(): Promise<SocialNet[]> {
  const out: SocialNet[] = [];
  if (await getSecret('instagram')) out.push('instagram');
  if (await getSecret('facebook')) out.push('facebook');
  return out;
}

// ---------- images ----------

/**
 * Photos for Meta: Instagram fetches them by public URL, accepts only JPEG/PNG between 4:5 and 1.91:1,
 * and a carousel must share one ratio — so every photo becomes a 1080×1350 JPEG on the store background.
 */
export async function socialJpeg(productId: number, index: number): Promise<Buffer | null> {
  const img = await one<{ url: string }>('SELECT url FROM product_images WHERE product_id = $1 ORDER BY sort_order, id OFFSET $2 LIMIT 1', [productId, index]);
  const raw = img ? await imageBytes(img.url) : null;
  if (!raw) return null;
  try {
    return await sharp(raw, { density: 200 })
      .flatten({ background: '#f6f3ee' })
      .resize({ width: 1080, height: 1350, fit: 'contain', background: '#f6f3ee' })
      .jpeg({ quality: 88 })
      .toBuffer();
  } catch {
    return null;
  }
}

async function photoUrls(productId: number, max: number): Promise<string[]> {
  const rows = await query<{ n: number; v: string }>(
    `SELECT (row_number() OVER (ORDER BY sort_order, id) - 1)::int AS n, md5(url) AS v FROM product_images WHERE product_id = $1 ORDER BY sort_order, id LIMIT $2`,
    [productId, max],
  );
  // the hash makes Meta fetch a fresh copy when the photo changes
  return rows.map((r) => `${config.publicUrl}/api/social/p/${productId}/${r.n}.jpg?v=${r.v.slice(0, 8)}`);
}

// ---------- captions ----------

async function plainCaption(productId: number, kind: PostKind, net: SocialNet): Promise<{ text: string; url: string } | null> {
  const d = await postParts(productId, kind);
  if (!d) return null;
  const social = (await getSettings()).social;
  const url = `${config.publicUrl}/product/${d.slug}`;
  const price = `${money(d.price)}${d.discount ? ` (було ${money(d.oldPrice!)}, −${d.discount}%)` : ''}`;
  const head = [d.header, d.name.toUpperCase(), price].filter(Boolean).join('\n');
  const facts = [
    d.sizes.length ? `Розміри: ${d.sizes.join(' · ')}` : '',
    d.colors.length ? `Кольори: ${d.colors.join(', ')}` : '',
    d.composition ? `Склад: ${d.composition}` : '',
  ].filter(Boolean).join('\n');
  // Instagram captions can't carry links — people go through the link in the profile
  const cta = net === 'instagram' ? '🛍 Замовити — посилання в профілі' : `🛍 Замовити: ${url}`;
  const tags = social.hashtags.trim();
  const limit = net === 'instagram' ? 2100 : 3000;
  const desc = fitText(d.description, limit - head.length - facts.length - cta.length - tags.length - 12);
  return { text: [head, desc, facts, cta, tags].filter(Boolean).join('\n\n'), url };
}

// ---------- publishing ----------

/** Instagram Login accounts live on graph.instagram.com, Page-linked ones on graph.facebook.com. */
const igHost = (acc: InstagramAccount) => (acc.via === 'facebook' ? config.meta.graphUrl : config.meta.igGraphUrl);

async function waitForContainer(host: string, id: string, token: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const r = await meta<{ status_code?: string }>(`${host}/${id}`, { fields: 'status_code', access_token: token });
    if (!r.status_code || r.status_code === 'FINISHED') return;
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') throw new MetaError('Instagram не зміг обробити фото');
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new MetaError('Instagram надто довго обробляє фото — спробуємо пізніше');
}

/** Single photo or a carousel (2–10) with a caption; returns the published media id. */
async function instagramPublish(urls: string[], caption: string): Promise<{ id: string; account: string }> {
  const acc = await getSecret<InstagramAccount>('instagram');
  if (!acc) throw new MetaError('Instagram не підключено');
  if (!urls.length) throw new MetaError('Для Instagram потрібне хоча б одне фото товару');
  const host = igHost(acc);
  const base = `${host}/${acc.userId}`;
  let container: string;
  if (urls.length === 1) {
    container = (await meta<{ id: string }>(`${base}/media`, { image_url: urls[0]!, caption, access_token: acc.token }, 'POST')).id;
  } else {
    const children: string[] = [];
    for (const image_url of urls.slice(0, 10)) {
      children.push((await meta<{ id: string }>(`${base}/media`, { image_url, is_carousel_item: 'true', access_token: acc.token }, 'POST')).id);
    }
    for (const c of children) await waitForContainer(host, c, acc.token);
    container = (await meta<{ id: string }>(`${base}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption, access_token: acc.token }, 'POST')).id;
  }
  await waitForContainer(host, container, acc.token);
  const published = await meta<{ id: string }>(`${base}/media_publish`, { creation_id: container, access_token: acc.token }, 'POST');
  return { id: published.id, account: acc.userId };
}

/** Photo post, multi-photo post or (without photos) a link post on the Page. */
async function facebookPublish(urls: string[], message: string, link: string): Promise<{ id: string; account: string }> {
  const acc = await getSecret<FacebookAccount>('facebook');
  if (!acc) throw new MetaError('Facebook не підключено');
  const base = `${config.meta.graphUrl}/${acc.pageId}`;
  const token = acc.pageToken;
  if (!urls.length) {
    const r = await meta<{ id: string }>(`${base}/feed`, { message, link, access_token: token }, 'POST');
    return { id: r.id, account: acc.pageId };
  }
  if (urls.length === 1) {
    const r = await meta<{ id: string; post_id?: string }>(`${base}/photos`, { url: urls[0]!, message, access_token: token }, 'POST');
    return { id: r.post_id ?? r.id, account: acc.pageId };
  }
  const params: Record<string, string> = { message, access_token: token };
  let i = 0;
  for (const url of urls.slice(0, 10)) {
    const photo = await meta<{ id: string }>(`${base}/photos`, { url, published: 'false', access_token: token }, 'POST');
    params[`attached_media[${i++}]`] = JSON.stringify({ media_fbid: photo.id });
  }
  const r = await meta<{ id: string }>(`${base}/feed`, params, 'POST');
  return { id: r.id, account: acc.pageId };
}

export async function publishToNetwork(net: SocialNet, productId: number, kind: PostKind): Promise<string> {
  if (!config.publicUrl.startsWith('https://')) throw new MetaError('Публікація в Instagram/Facebook працює лише на сайті з https-адресою');
  const c = await plainCaption(productId, kind, net);
  if (!c) throw new MetaError('Товар не знайдено');
  const album = (await getSettings()).channel.album;
  const urls = await photoUrls(productId, net === 'instagram' ? (album ? 4 : 1) : album ? 4 : 1);
  const r = net === 'instagram' ? await instagramPublish(urls, c.text) : await facebookPublish(urls, c.text, c.url);
  await query('INSERT INTO telegram_posts(product_id, chat_id, external_id, kind, target) VALUES ($1, $2, $3, $4, $5)', [productId, r.account, r.id, kind, net]);
  return r.id;
}

/** «Новинки тижня» for Instagram/Facebook: first photos of the products and a numbered list. */
export async function publishDigestToNetwork(net: SocialNet, list: { id: number; name: string; slug: string; price: number; old_price: number | null }[]): Promise<string> {
  const tags = (await getSettings()).social.hashtags.trim();
  const rows = list.map((p, i) => `${i + 1}. ${p.name} — ${money(Number(p.price))}${net === 'facebook' ? `\n${config.publicUrl}/product/${p.slug}` : ''}`);
  const cta = net === 'instagram' ? '🛍 Усі новинки — за посиланням у профілі' : `🛍 Увесь каталог: ${config.publicUrl}/catalog`;
  const text = ['✨ НОВИНКИ ТИЖНЯ', rows.join('\n'), cta, tags].filter(Boolean).join('\n\n');
  const urls: string[] = [];
  for (const p of list) {
    const [u] = await photoUrls(p.id, 1);
    if (u) urls.push(u);
  }
  const r = net === 'instagram' ? await instagramPublish(urls.slice(0, 10), text) : await facebookPublish(urls.slice(0, 10), text, `${config.publicUrl}/catalog`);
  return r.id;
}

/** Daily: keeps the Instagram token alive. */
export function startSocialJob(): void {
  const run = () => refreshInstagramToken().catch((err) => console.error('[instagram token]', err instanceof Error ? err.message : err));
  setTimeout(run, 90_000).unref();
  setInterval(run, 24 * 3600_000).unref();
}
