import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../db/pool.js';
import { notFound } from '../utils/errors.js';

export const catalogRouter = Router();

export interface CategoryNode {
  id: number;
  parent_id: number | null;
  name: string;
  slug: string;
  description: string;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
  show_in_menu: boolean;
  product_count?: number;
  children: CategoryNode[];
}

export function buildTree(rows: Omit<CategoryNode, 'children'>[]): CategoryNode[] {
  const byId = new Map<number, CategoryNode>();
  rows.forEach((r) => byId.set(r.id, { ...r, children: [] }));
  const roots: CategoryNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else if (!node.parent_id) roots.push(node);
  }
  const sort = (list: CategoryNode[]) => {
    list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

/** SELECT list for product cards (used by catalog, search, chatbot). */
export const PRODUCT_CARD_SQL = `
  p.id, p.name, p.slug, p.price, p.old_price, p.is_new, p.is_featured, p.created_at,
  c.slug AS category_slug, c.name AS category_name,
  COALESCE((SELECT array_agg(url ORDER BY sort_order, id) FROM (
    SELECT url, sort_order, id FROM product_images WHERE product_id = p.id ORDER BY sort_order, id LIMIT 2) im), '{}') AS images,
  COALESCE((SELECT json_agg(DISTINCT jsonb_build_object('name', v.color, 'hex', v.color_hex))
    FROM product_variants v WHERE v.product_id = p.id AND v.color <> ''), '[]') AS colors,
  COALESCE((SELECT array_agg(s.size ORDER BY s.ord) FROM (
    SELECT size, MIN(sort_order) AS ord FROM product_variants WHERE product_id = p.id AND size <> '' GROUP BY size) s), '{}') AS sizes,
  COALESCE((SELECT SUM(stock) FROM product_variants WHERE product_id = p.id), 0) > 0 AS in_stock`;

async function categoryWithDescendants(slug: string): Promise<number[]> {
  const rows = await query<{ id: number }>(
    `WITH RECURSIVE tree AS (
       SELECT id FROM categories WHERE slug = $1 AND is_active
       UNION ALL
       SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id WHERE c.is_active
     ) SELECT id FROM tree`,
    [slug],
  );
  return rows.map((r) => r.id);
}

catalogRouter.get('/categories', async (_req, res) => {
  const rows = await query(
    `SELECT c.id, c.parent_id, c.name, c.slug, c.description, c.image_url, c.sort_order, c.is_active, c.show_in_menu,
       (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_active) AS product_count
     FROM categories c WHERE c.is_active`,
  );
  res.json(buildTree(rows));
});

catalogRouter.get('/categories/:slug', async (req, res) => {
  const cat = await one('SELECT * FROM categories WHERE slug = $1 AND is_active', [req.params.slug]);
  if (!cat) throw notFound('Категорію не знайдено');
  const breadcrumbs = await query(
    `WITH RECURSIVE up AS (
       SELECT id, parent_id, name, slug, 0 AS depth FROM categories WHERE id = $1
       UNION ALL
       SELECT c.id, c.parent_id, c.name, c.slug, up.depth + 1 FROM categories c JOIN up ON c.id = up.parent_id
     ) SELECT name, slug FROM up ORDER BY depth DESC`,
    [cat.id],
  );
  const children = await query(
    'SELECT id, name, slug, image_url FROM categories WHERE parent_id = $1 AND is_active ORDER BY sort_order, name',
    [cat.id],
  );
  res.json({ ...cat, breadcrumbs, children });
});

const listSchema = z.object({
  category: z.string().optional(),
  q: z.string().trim().max(100).optional(),
  sizes: z.string().optional(),
  colors: z.string().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  sale: z.string().optional(),
  new: z.string().optional(),
  featured: z.string().optional(),
  inStock: z.string().optional(),
  ids: z.string().optional(),
  sort: z.enum(['new', 'price_asc', 'price_desc', 'popular', 'name']).default('new'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});

export type ProductListParams = z.infer<typeof listSchema>;

export async function listProducts(params: ProductListParams) {
  const where: string[] = ['p.is_active'];
  const values: unknown[] = [];
  const add = (v: unknown) => {
    values.push(v);
    return `$${values.length}`;
  };

  if (params.category) {
    const ids = await categoryWithDescendants(params.category);
    where.push(`p.category_id = ANY(${add(ids.length ? ids : [-1])})`);
  }
  if (params.q) {
    const term = add(`%${params.q}%`);
    where.push(`(p.name ILIKE ${term} OR p.description ILIKE ${term} OR p.sku ILIKE ${term} OR c.name ILIKE ${term} OR ${add(params.q.toLowerCase())} = ANY(p.tags))`);
  }
  if (params.ids) {
    const ids = params.ids.split(',').map(Number).filter(Number.isInteger);
    where.push(`p.id = ANY(${add(ids)})`);
  }
  // Facets are computed before size/colour/price narrowing so the filter panel stays stable
  const baseWhere = [...where];
  const baseValues = [...values];

  if (params.sizes) {
    where.push(`EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.size = ANY(${add(params.sizes.split(','))}) AND v.stock > 0)`);
  }
  if (params.colors) {
    where.push(`EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.color = ANY(${add(params.colors.split(','))}))`);
  }
  if (params.minPrice !== undefined) where.push(`p.price >= ${add(params.minPrice)}`);
  if (params.maxPrice !== undefined) where.push(`p.price <= ${add(params.maxPrice)}`);
  if (params.sale) where.push('p.old_price IS NOT NULL AND p.old_price > p.price');
  if (params.new) where.push('p.is_new');
  if (params.featured) where.push('p.is_featured');
  if (params.inStock) where.push('EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.stock > 0)');

  const order = {
    new: 'p.created_at DESC, p.id DESC',
    price_asc: 'p.price ASC, p.id',
    price_desc: 'p.price DESC, p.id',
    popular: 'p.sales_count DESC, p.created_at DESC',
    name: 'p.name ASC',
  }[params.sort];

  const from = 'FROM products p LEFT JOIN categories c ON c.id = p.category_id';
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const offset = (params.page - 1) * params.limit;

  const [items, countRow, facets] = await Promise.all([
    query(`SELECT ${PRODUCT_CARD_SQL} ${from} ${whereSql} ORDER BY ${order} LIMIT ${params.limit} OFFSET ${offset}`, values),
    one<{ total: number }>(`SELECT COUNT(*) AS total ${from} ${whereSql}`, values),
    one(
      `WITH base AS (SELECT p.id, p.price ${from} WHERE ${baseWhere.join(' AND ')})
       SELECT
         COALESCE((SELECT array_agg(size ORDER BY ord) FROM (
           SELECT v.size, MIN(v.sort_order) AS ord FROM product_variants v JOIN base b ON b.id = v.product_id
           WHERE v.size <> '' GROUP BY v.size) s), '{}') AS sizes,
         COALESCE((SELECT json_agg(x) FROM (
           SELECT DISTINCT ON (v.color) v.color AS name, v.color_hex AS hex FROM product_variants v JOIN base b ON b.id = v.product_id
           WHERE v.color <> '' ORDER BY v.color) x), '[]') AS colors,
         (SELECT MIN(price) FROM base) AS min_price,
         (SELECT MAX(price) FROM base) AS max_price`,
      baseValues,
    ),
  ]);
  const total = countRow?.total ?? 0;
  return {
    items,
    total,
    page: params.page,
    pages: Math.max(1, Math.ceil(total / params.limit)),
    facets: {
      sizes: facets?.sizes ?? [],
      colors: facets?.colors ?? [],
      price: { min: facets?.min_price ?? 0, max: facets?.max_price ?? 0 },
    },
  };
}

catalogRouter.get('/products', async (req, res) => {
  res.json(await listProducts(listSchema.parse(req.query)));
});

catalogRouter.get('/products/:slug', async (req, res) => {
  const product = await one(
    `SELECT p.*, c.slug AS category_slug, c.name AS category_name
     FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.slug = $1 AND p.is_active`,
    [req.params.slug],
  );
  if (!product) throw notFound('Товар не знайдено');
  const [images, variants, breadcrumbs, related] = await Promise.all([
    query('SELECT id, url, alt, color FROM product_images WHERE product_id = $1 ORDER BY sort_order, id', [product.id]),
    query(
      'SELECT id, size, color, color_hex, sku, stock, price FROM product_variants WHERE product_id = $1 ORDER BY sort_order, id',
      [product.id],
    ),
    product.category_id
      ? query(
          `WITH RECURSIVE up AS (
             SELECT id, parent_id, name, slug, 0 AS depth FROM categories WHERE id = $1
             UNION ALL
             SELECT c.id, c.parent_id, c.name, c.slug, up.depth + 1 FROM categories c JOIN up ON c.id = up.parent_id
           ) SELECT name, slug FROM up ORDER BY depth DESC`,
          [product.category_id],
        )
      : Promise.resolve([]),
    query(
      `SELECT ${PRODUCT_CARD_SQL} FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.is_active AND p.id <> $1 AND p.category_id IS NOT DISTINCT FROM $2
       ORDER BY p.is_featured DESC, p.created_at DESC LIMIT 8`,
      [product.id, product.category_id],
    ),
  ]);
  res.json({ ...product, images, variants, breadcrumbs, related });
});

/** Re-prices a client-side cart against the database. */
catalogRouter.post('/cart/check', async (req, res) => {
  const body = z
    .object({ items: z.array(z.object({ variantId: z.number().int(), quantity: z.number().int().min(1).max(99) })).max(50) })
    .parse(req.body);
  const ids = body.items.map((i) => i.variantId);
  const rows = await query(
    `SELECT v.id AS variant_id, v.size, v.color, v.stock, COALESCE(v.price, p.price) AS price, p.old_price,
       p.id AS product_id, p.name, p.slug, p.is_active,
       (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image
     FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ANY($1)`,
    [ids],
  );
  const byId = new Map(rows.map((r) => [r.variant_id, r]));
  res.json({
    items: body.items.map((i) => {
      const r = byId.get(i.variantId);
      if (!r || !r.is_active) return { variantId: i.variantId, available: false, stock: 0 };
      return { variantId: i.variantId, available: r.stock > 0, stock: r.stock, price: r.price, oldPrice: r.old_price, name: r.name, slug: r.slug, size: r.size, color: r.color, image: r.image, productId: r.product_id };
    }),
  });
});

catalogRouter.get('/banners', async (_req, res) => {
  res.json(await query('SELECT * FROM banners WHERE is_active ORDER BY sort_order, id'));
});

catalogRouter.get('/faq', async (_req, res) => {
  res.json(await query('SELECT id, question, answer FROM faq_items WHERE is_active ORDER BY sort_order, id'));
});

catalogRouter.post('/subscribe', async (req, res) => {
  const { email } = z.object({ email: z.string().trim().toLowerCase().email() }).parse(req.body);
  await query('INSERT INTO subscribers(email) VALUES ($1) ON CONFLICT DO NOTHING', [email]);
  res.json({ ok: true });
});
