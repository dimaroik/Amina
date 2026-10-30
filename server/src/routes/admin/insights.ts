import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { query } from '../../db/pool.js';
import { aiEnabled, draftProduct } from '../../services/product-ai.js';
import { badRequest, HttpError } from '../../utils/errors.js';

export const adminInsightsRouter = Router();

// ---------- AI product drafts ----------

const aiLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 40, standardHeaders: true, legacyHeaders: false });

adminInsightsRouter.get('/ai/status', (_req, res) => {
  res.json({ enabled: aiEnabled() });
});

adminInsightsRouter.post('/ai/product-draft', aiLimiter, async (req, res) => {
  if (!aiEnabled()) throw badRequest('ШІ не підключено: додайте ANTHROPIC_API_KEY у змінні середовища Render');
  const b = z
    .object({
      text: z.string().max(6000).default(''),
      images: z.array(z.string().max(500)).max(4).default([]),
      colors: z.array(z.string().trim().min(1).max(60)).min(1).max(60),
      sizes: z.array(z.string().trim().min(1).max(30)).min(1).max(40),
    })
    .parse(req.body);
  if (!b.text.trim() && !b.images.length) throw badRequest('Додайте фото або вставте опис від постачальника');
  try {
    res.json(await draftProduct(b));
  } catch (err) {
    console.error('[ai draft]', err);
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'ШІ зараз перевантажений — спробуйте за хвилину');
    throw new HttpError(502, 'ШІ не зміг підготувати опис — спробуйте ще раз або заповніть вручну');
  }
});

// ---------- restock report ----------

interface VariantRow {
  id: number;
  product_id: number;
  name: string;
  slug: string;
  image: string | null;
  is_active: boolean;
  product_created: string;
  size: string;
  color: string;
  color_hex: string | null;
  stock: number;
  price: number;
  cost_price: number | null;
  incoming: number;
  waiting: number;
  last_sale_at: string | null;
  sold: number;
  revenue: number;
  profit: number | null;
  covered: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

adminInsightsRouter.get('/reports/restock', async (req, res) => {
  const p = z
    .object({
      days: z.coerce.number().int().min(7).max(365).default(60),
      target: z.coerce.number().int().min(7).max(180).default(45),
      dead: z.coerce.number().int().min(14).max(365).default(60),
    })
    .parse(req.query);

  const rows = await query<VariantRow>(
    `WITH sales AS (
       SELECT oi.variant_id, SUM(oi.quantity)::int AS sold, SUM(oi.price * oi.quantity) AS revenue,
         SUM((oi.price - oi.cost_price) * oi.quantity) FILTER (WHERE oi.cost_price IS NOT NULL) AS profit,
         COALESCE(SUM(oi.price * oi.quantity) FILTER (WHERE oi.cost_price IS NOT NULL), 0) AS covered
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.status NOT IN ('cancelled', 'returned') AND oi.variant_id IS NOT NULL
         AND o.created_at >= now() - make_interval(days => $1)
       GROUP BY oi.variant_id
     ), last_sale AS (
       SELECT oi.variant_id, MAX(o.created_at) AS at FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.status NOT IN ('cancelled', 'returned') GROUP BY oi.variant_id
     ), incoming AS (
       SELECT si.variant_id, SUM(si.quantity)::int AS qty FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id
       WHERE s.status = 'in_transit' AND si.variant_id IS NOT NULL GROUP BY si.variant_id
     ), promised AS (
       SELECT oi.variant_id, SUM(oi.quantity)::int AS qty FROM order_items oi
       JOIN orders o ON o.id = oi.order_id JOIN shipments s ON s.id = oi.preorder_shipment_id
       WHERE s.status = 'in_transit' AND o.status NOT IN ('cancelled', 'returned') GROUP BY oi.variant_id
     ), waiting AS (
       SELECT variant_id, COUNT(*)::int AS n FROM stock_alerts WHERE notified_at IS NULL GROUP BY variant_id
     )
     SELECT v.id, v.product_id, p.name, p.slug, p.is_active, p.created_at AS product_created,
       v.size, v.color, v.color_hex, v.stock, COALESCE(v.price, p.price) AS price, v.cost_price,
       (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image,
       GREATEST(0, COALESCE(i.qty, 0) - COALESCE(pr.qty, 0)) AS incoming,
       COALESCE(w.n, 0) AS waiting, ls.at AS last_sale_at,
       COALESCE(s.sold, 0) AS sold, COALESCE(s.revenue, 0) AS revenue, s.profit, COALESCE(s.covered, 0) AS covered
     FROM product_variants v JOIN products p ON p.id = v.product_id
     LEFT JOIN sales s ON s.variant_id = v.id
     LEFT JOIN last_sale ls ON ls.variant_id = v.id
     LEFT JOIN incoming i ON i.variant_id = v.id
     LEFT JOIN promised pr ON pr.variant_id = v.id
     LEFT JOIN waiting w ON w.variant_id = v.id
     ORDER BY p.name, v.sort_order, v.id`,
    [p.days],
  );

  // --- what to reorder: cover `target` days of sales at the current pace
  const variantLine = (v: VariantRow) => {
    const daily = v.sold / p.days;
    const need = Math.ceil(daily * p.target);
    const suggest = Math.max(0, need - v.stock - v.incoming, v.waiting - v.stock - v.incoming);
    return {
      variant_id: v.id,
      size: v.size,
      color: v.color,
      color_hex: v.color_hex,
      stock: v.stock,
      incoming: v.incoming,
      waiting: v.waiting,
      sold: v.sold,
      per_week: round(daily * 7),
      cover_days: daily > 0 ? Math.round((v.stock + v.incoming) / daily) : null,
      suggest,
      sold_out: v.stock === 0 && (v.sold > 0 || v.waiting > 0),
    };
  };
  const byProduct = new Map<number, VariantRow[]>();
  for (const r of rows) byProduct.set(r.product_id, [...(byProduct.get(r.product_id) ?? []), r]);

  const products = [...byProduct.values()].map((vs) => {
    const first = vs[0]!;
    const lines = vs.map(variantLine);
    const sold = vs.reduce((n, v) => n + v.sold, 0);
    const revenue = vs.reduce((n, v) => n + Number(v.revenue), 0);
    const covered = vs.reduce((n, v) => n + Number(v.covered), 0);
    const profit = vs.some((v) => v.profit !== null) ? vs.reduce((n, v) => n + Number(v.profit ?? 0), 0) : null;
    const costs = vs.map((v) => v.cost_price).filter((c): c is number => c !== null);
    return {
      product_id: first.product_id,
      name: first.name,
      slug: first.slug,
      image: first.image,
      is_active: first.is_active,
      price: first.price,
      unit_cost: costs.length ? round(costs.reduce((a, b) => a + b, 0) / costs.length) : null,
      sold,
      revenue: round(revenue),
      profit: profit === null ? null : round(profit),
      margin: profit !== null && covered > 0 ? round((profit / covered) * 100) : null,
      stock: vs.reduce((n, v) => n + v.stock, 0),
      incoming: vs.reduce((n, v) => n + v.incoming, 0),
      suggest: lines.reduce((n, l) => n + l.suggest, 0),
      lines: lines.filter((l) => l.sold > 0 || l.waiting > 0 || l.suggest > 0),
    };
  });

  const reorder = products
    .filter((pr) => pr.suggest > 0)
    .sort((a, b) => b.suggest - a.suggest || b.sold - a.sold)
    .map((pr) => ({ ...pr, lines: pr.lines.filter((l) => l.suggest > 0 || l.sold_out) }));

  const top = products
    .filter((pr) => pr.sold > 0)
    .sort((a, b) => b.sold - a.sold || b.revenue - a.revenue)
    .slice(0, 10)
    .map(({ lines: _lines, ...rest }) => rest);

  // --- size / colour demand
  const tally = (key: 'size' | 'color') => {
    const m = new Map<string, { sold: number; hex: string | null; stock: number }>();
    for (const r of rows) {
      const k = r[key];
      if (!k) continue;
      const cur = m.get(k) ?? { sold: 0, hex: r.color_hex, stock: 0 };
      cur.sold += r.sold;
      cur.stock += r.stock;
      m.set(k, cur);
    }
    return [...m].map(([name, v]) => ({ name, ...v })).filter((x) => x.sold > 0 || x.stock > 0).sort((a, b) => b.sold - a.sold);
  };

  // --- dead stock: in stock, but nothing sold for `dead` days (new arrivals get a grace period)
  const deadSince = Date.now() - p.dead * 86_400_000;
  const dead = [...byProduct.values()]
    .map((vs) => {
      const stale = vs.filter((v) => v.stock > 0 && (!v.last_sale_at || new Date(v.last_sale_at).getTime() < deadSince));
      const first = vs[0]!;
      if (!stale.length || new Date(first.product_created).getTime() > deadSince) return null;
      const lastSale = vs.map((v) => v.last_sale_at).filter(Boolean).sort().at(-1) ?? null;
      const units = stale.reduce((n, v) => n + v.stock, 0);
      const known = stale.filter((v) => v.cost_price !== null);
      return {
        product_id: first.product_id,
        name: first.name,
        slug: first.slug,
        image: first.image,
        is_active: first.is_active,
        price: first.price,
        units,
        sizes: stale.map((v) => [v.color, v.size].filter(Boolean).join(' ') || '—'),
        cost_value: known.length ? round(known.reduce((n, v) => n + v.stock * Number(v.cost_price), 0)) : null,
        cost_partial: known.length > 0 && known.length < stale.length,
        retail_value: round(stale.reduce((n, v) => n + v.stock * Number(v.price), 0)),
        last_sale_at: lastSale,
        days_idle: Math.floor((Date.now() - new Date(lastSale ?? first.product_created).getTime()) / 86_400_000),
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .sort((a, b) => (b.cost_value ?? b.retail_value / 3) - (a.cost_value ?? a.retail_value / 3));

  // --- how received shipments paid back (sales of their variants since arrival, pre-orders included)
  const shipments = await query<{
    id: number;
    title: string;
    received_at: string;
    units: number;
    cost: number;
    sold: number;
    revenue: number;
  }>(
    `WITH items AS (
       SELECT si.shipment_id, si.variant_id, SUM(si.quantity)::int AS qty, SUM(si.quantity * si.landed_cost) AS cost
       FROM shipment_items si GROUP BY si.shipment_id, si.variant_id
     ), sold AS (
       SELECT it.shipment_id, it.variant_id, it.qty, it.cost,
         COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id
           WHERE oi.variant_id = it.variant_id AND o.status NOT IN ('cancelled', 'returned')
             AND (oi.preorder_shipment_id = it.shipment_id OR (oi.preorder_shipment_id IS NULL AND o.created_at >= s.received_at))), 0)::int AS sold_raw,
         (SELECT AVG(oi.price) FROM order_items oi JOIN orders o ON o.id = oi.order_id
           WHERE oi.variant_id = it.variant_id AND o.status NOT IN ('cancelled', 'returned')
             AND (oi.preorder_shipment_id = it.shipment_id OR (oi.preorder_shipment_id IS NULL AND o.created_at >= s.received_at))) AS avg_price
       FROM items it JOIN shipments s ON s.id = it.shipment_id
       WHERE s.status = 'received'
     )
     SELECT s.id, s.title, s.received_at, SUM(x.qty)::int AS units, COALESCE(SUM(x.cost), 0) AS cost,
       SUM(LEAST(x.qty, x.sold_raw))::int AS sold, COALESCE(SUM(LEAST(x.qty, x.sold_raw) * x.avg_price), 0) AS revenue
     FROM shipments s JOIN sold x ON x.shipment_id = s.id
     WHERE s.received_at >= now() - interval '1 year'
     GROUP BY s.id ORDER BY s.received_at DESC LIMIT 20`,
  );

  const sumSold = products.reduce((n, pr) => n + pr.sold, 0);
  const sumRevenue = products.reduce((n, pr) => n + pr.revenue, 0);
  const sumCovered = rows.reduce((n, r) => n + Number(r.covered), 0);
  const sumProfit = rows.reduce((n, r) => n + Number(r.profit ?? 0), 0);
  res.json({
    params: p,
    summary: {
      sold: sumSold,
      revenue: round(sumRevenue),
      profit: sumCovered > 0 ? round(sumProfit) : null,
      margin: sumCovered > 0 ? round((sumProfit / sumCovered) * 100) : null,
      profit_coverage: sumRevenue > 0 ? round((sumCovered / sumRevenue) * 100) : 0,
      sold_out: rows.filter((r) => r.stock === 0 && (r.sold > 0 || r.waiting > 0)).length,
      reorder_units: reorder.reduce((n, r) => n + r.suggest, 0),
      dead_units: dead.reduce((n, d) => n + d.units, 0),
      dead_cost: round(dead.reduce((n, d) => n + (d.cost_value ?? 0), 0)),
      dead_retail: round(dead.reduce((n, d) => n + d.retail_value, 0)),
    },
    reorder,
    top,
    sizes: tally('size'),
    colors: tally('color'),
    dead,
    shipments: shipments.map((s) => ({
      ...s,
      cost: round(Number(s.cost)),
      revenue: round(Number(s.revenue)),
      sell_through: s.units ? round((s.sold / s.units) * 100) : 0,
      payback: Number(s.cost) > 0 ? round((Number(s.revenue) / Number(s.cost)) * 100) : null,
    })),
  });
});
