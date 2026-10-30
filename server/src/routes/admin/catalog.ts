import { Router } from 'express';
import { scheduleAuto } from '../../services/channel.js';
import { getSettings } from '../../services/settings.js';
import multer from 'multer';
import { z } from 'zod';
import { one, query, tx } from '../../db/pool.js';
import { storeImage } from '../../services/images.js';
import { processStockAlerts } from '../../services/stock-alerts.js';
import { slugify } from '../../utils/slug.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { buildTree } from '../catalog.js';

export const adminCatalogRouter = Router();

async function uniqueSlug(table: 'categories' | 'products', base: string, excludeId?: number): Promise<string> {
  const root = slugify(base);
  let slug = root;
  for (let i = 2; ; i++) {
    const row = await one(`SELECT id FROM ${table} WHERE slug = $1 AND id IS DISTINCT FROM $2`, [slug, excludeId ?? null]);
    if (!row) return slug;
    slug = `${root}-${i}`;
  }
}

// ---------- uploads ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

adminCatalogRouter.post('/uploads', upload.array('files', 20), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw badRequest('Оберіть зображення');
  const stored = [];
  for (const f of files) stored.push(await storeImage(f.buffer));
  res.status(201).json(stored);
});

// ---------- categories ----------
const categorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().max(120).optional(),
  parent_id: z.number().int().nullable().default(null),
  description: z.string().max(5000).default(''),
  image_url: z.string().max(500).nullable().default(null),
  sort_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
  show_in_menu: z.boolean().default(true),
});

adminCatalogRouter.get('/categories', async (_req, res) => {
  const rows = await query(
    `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count FROM categories c`,
  );
  res.json(buildTree(rows));
});

adminCatalogRouter.post('/categories', async (req, res) => {
  const b = categorySchema.parse(req.body);
  const slug = await uniqueSlug('categories', b.slug || b.name);
  const row = await one(
    `INSERT INTO categories(name, slug, parent_id, description, image_url, sort_order, is_active, show_in_menu)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [b.name, slug, b.parent_id, b.description, b.image_url, b.sort_order, b.is_active, b.show_in_menu],
  );
  res.status(201).json(row);
});

async function assertNoCycle(id: number, parentId: number | null) {
  if (parentId === null) return;
  if (parentId === id) throw badRequest('Категорія не може бути батьківською сама для себе');
  const loop = await one(
    `WITH RECURSIVE up AS (SELECT id, parent_id FROM categories WHERE id = $1
       UNION ALL SELECT c.id, c.parent_id FROM categories c JOIN up ON c.id = up.parent_id)
     SELECT 1 FROM up WHERE id = $2`,
    [parentId, id],
  );
  if (loop) throw badRequest('Не можна вкласти категорію у власну підкатегорію');
}

adminCatalogRouter.put('/categories/:id', async (req, res) => {
  const id = Number(req.params.id);
  const b = categorySchema.parse(req.body);
  await assertNoCycle(id, b.parent_id);
  const slug = await uniqueSlug('categories', b.slug || b.name, id);
  const row = await one(
    `UPDATE categories SET name=$2, slug=$3, parent_id=$4, description=$5, image_url=$6, sort_order=$7, is_active=$8, show_in_menu=$9
     WHERE id=$1 RETURNING *`,
    [id, b.name, slug, b.parent_id, b.description, b.image_url, b.sort_order, b.is_active, b.show_in_menu],
  );
  if (!row) throw notFound();
  res.json(row);
});

adminCatalogRouter.post('/categories/reorder', async (req, res) => {
  const items = z.array(z.object({ id: z.number().int(), parent_id: z.number().int().nullable(), sort_order: z.number().int() })).parse(req.body);
  for (const it of items) await assertNoCycle(it.id, it.parent_id);
  await tx(async (client) => {
    for (const it of items) {
      await client.query('UPDATE categories SET parent_id = $2, sort_order = $3 WHERE id = $1', [it.id, it.parent_id, it.sort_order]);
    }
  });
  res.json({ ok: true });
});

adminCatalogRouter.delete('/categories/:id', async (req, res) => {
  const id = Number(req.params.id);
  // Products from the deleted branch are kept, just detached (ON DELETE SET NULL)
  await query('DELETE FROM categories WHERE id = $1', [id]);
  res.json({ ok: true });
});

// ---------- products ----------
export const productSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().max(200).optional(),
  category_id: z.number().int().nullable().default(null),
  sku: z.string().trim().max(60).default(''),
  description: z.string().max(10000).default(''),
  composition: z.string().max(2000).default(''),
  care: z.string().max(2000).default(''),
  price: z.number().min(0),
  old_price: z.number().min(0).nullable().default(null),
  is_active: z.boolean().default(true),
  is_featured: z.boolean().default(false),
  is_new: z.boolean().default(true),
  tags: z.array(z.string().trim().toLowerCase()).default([]),
  images: z
    .array(z.object({ url: z.string().min(1).max(500), alt: z.string().max(200).default(''), color: z.string().max(60).nullable().default(null) }))
    .default([]),
  variants: z
    .array(
      z.object({
        id: z.number().int().optional(),
        size: z.string().trim().max(30).default(''),
        color: z.string().trim().max(60).default(''),
        color_hex: z.string().trim().max(20).nullable().default(null),
        sku: z.string().trim().max(60).default(''),
        stock: z.number().int().min(0).default(0),
        price: z.number().min(0).nullable().default(null),
        cost_price: z.number().min(0).nullable().optional(),
      }),
    )
    .min(1, 'Додайте хоча б один варіант (розмір/колір)'),
});

adminCatalogRouter.get('/products', async (req, res) => {
  const p = z
    .object({
      q: z.string().trim().optional(),
      category_id: z.coerce.number().int().optional(),
      status: z.enum(['active', 'hidden', 'out', 'low']).optional(),
      sort: z.enum(['new', 'name', 'price', 'stock', 'sales']).default('new'),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(200).default(30),
    })
    .parse(req.query);
  const where = ['TRUE'];
  const values: unknown[] = [];
  const add = (v: unknown) => (values.push(v), `$${values.length}`);
  if (p.q) {
    const t = add(`%${p.q}%`);
    where.push(`(p.name ILIKE ${t} OR p.sku ILIKE ${t} OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.sku ILIKE ${t}))`);
  }
  if (p.category_id) {
    where.push(`p.category_id IN (WITH RECURSIVE t AS (SELECT id FROM categories WHERE id = ${add(p.category_id)}
      UNION ALL SELECT c.id FROM categories c JOIN t ON c.parent_id = t.id) SELECT id FROM t)`);
  }
  if (p.status === 'active') where.push('p.is_active');
  if (p.status === 'hidden') where.push('NOT p.is_active');
  if (p.status === 'out') where.push('(SELECT COALESCE(SUM(stock),0) FROM product_variants WHERE product_id = p.id) = 0');
  if (p.status === 'low') where.push('(SELECT COALESCE(SUM(stock),0) FROM product_variants WHERE product_id = p.id) BETWEEN 1 AND 3');
  const order = { new: 'p.created_at DESC', name: 'p.name', price: 'p.price DESC', stock: 'stock ASC', sales: 'p.sales_count DESC' }[p.sort];
  const sql = where.join(' AND ');
  const [items, count] = await Promise.all([
    query(
      `SELECT p.id, p.name, p.slug, p.sku, p.price, p.old_price, p.is_active, p.is_featured, p.is_new, p.sales_count, p.created_at,
         c.name AS category_name,
         (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image,
         (SELECT COALESCE(SUM(stock), 0) FROM product_variants WHERE product_id = p.id) AS stock,
         (SELECT COUNT(*) FROM product_variants WHERE product_id = p.id) AS variants_count,
         (SELECT COUNT(*) FROM stock_alerts a JOIN product_variants v ON v.id = a.variant_id
           WHERE v.product_id = p.id AND a.notified_at IS NULL) AS waiting
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE ${sql} ORDER BY ${order}, p.id DESC LIMIT ${p.limit} OFFSET ${(p.page - 1) * p.limit}`,
      values,
    ),
    one(`SELECT COUNT(*) AS total FROM products p WHERE ${sql}`, values),
  ]);
  res.json({ items, total: count.total, page: p.page, pages: Math.max(1, Math.ceil(count.total / p.limit)) });
});

/** Variant search for adding items to an order from the admin panel. */
adminCatalogRouter.get('/variants/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  res.json(
    await query(
      `SELECT v.id, v.size, v.color, v.stock, COALESCE(v.price, p.price) AS price, p.name, p.id AS product_id,
         (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image
       FROM product_variants v JOIN products p ON p.id = v.product_id
       WHERE p.name ILIKE $1 OR p.sku ILIKE $1 OR v.sku ILIKE $1 ORDER BY p.name, v.sort_order LIMIT 30`,
      [`%${q}%`],
    ),
  );
});

adminCatalogRouter.get('/products/:id', async (req, res) => {
  const id = Number(req.params.id);
  const product = await one('SELECT * FROM products WHERE id = $1', [id]);
  if (!product) throw notFound('Товар не знайдено');
  const [images, variants] = await Promise.all([
    query('SELECT url, alt, color FROM product_images WHERE product_id = $1 ORDER BY sort_order, id', [id]),
    query(
      `SELECT id, size, color, color_hex, sku, stock, price, cost_price,
         (SELECT COUNT(*) FROM stock_alerts a WHERE a.variant_id = v.id AND a.notified_at IS NULL) AS waiting
       FROM product_variants v WHERE product_id = $1 ORDER BY sort_order, id`,
      [id],
    ),
  ]);
  res.json({ ...product, images, variants });
});

export async function saveProduct(id: number | null, b: z.infer<typeof productSchema>) {
  const slug = await uniqueSlug('products', b.slug || b.name, id ?? undefined);
  return tx(async (client) => {
    const params = [b.name, slug, b.category_id, b.sku, b.description, b.composition, b.care, b.price, b.old_price, b.is_active, b.is_featured, b.is_new, b.tags];
    let productId = id;
    if (productId === null) {
      const { rows } = await client.query(
        `INSERT INTO products(name, slug, category_id, sku, description, composition, care, price, old_price, is_active, is_featured, is_new, tags)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        params,
      );
      productId = rows[0].id as number;
    } else {
      const { rowCount } = await client.query(
        `UPDATE products SET name=$2, slug=$3, category_id=$4, sku=$5, description=$6, composition=$7, care=$8, price=$9, old_price=$10,
           is_active=$11, is_featured=$12, is_new=$13, tags=$14, updated_at=now() WHERE id=$1`,
        [productId, ...params],
      );
      if (!rowCount) throw notFound('Товар не знайдено');
    }
    await client.query('DELETE FROM product_images WHERE product_id = $1', [productId]);
    for (const [i, img] of b.images.entries()) {
      await client.query('INSERT INTO product_images(product_id, url, alt, color, sort_order) VALUES ($1,$2,$3,$4,$5)', [productId, img.url, img.alt, img.color, i]);
    }
    // Variants are updated in place (order items reference them), removed ones are deleted
    const keepIds = b.variants.filter((v) => v.id).map((v) => v.id);
    await client.query('DELETE FROM product_variants WHERE product_id = $1 AND NOT (id = ANY($2))', [productId, keepIds]);
    for (const [i, v] of b.variants.entries()) {
      if (v.id) {
        await client.query(
          `UPDATE product_variants SET size=$3, color=$4, color_hex=$5, sku=$6, stock=$7, price=$8, sort_order=$9,
             cost_price = CASE WHEN $10::boolean THEN $11 ELSE cost_price END
           WHERE id=$1 AND product_id=$2`,
          [v.id, productId, v.size, v.color, v.color_hex, v.sku, v.stock, v.price, i, v.cost_price !== undefined, v.cost_price ?? null],
        );
      } else {
        await client.query(
          'INSERT INTO product_variants(product_id, size, color, color_hex, sku, stock, price, sort_order, cost_price) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [productId, v.size, v.color, v.color_hex, v.sku, v.stock, v.price, i, v.cost_price ?? null],
        );
      }
    }
    return productId;
  });
}

adminCatalogRouter.post('/products', async (req, res) => {
  const id = await saveProduct(null, productSchema.parse(req.body));
  processStockAlerts().catch((err) => console.error('[stock-alerts]', err));
  res.status(201).json(await one('SELECT * FROM products WHERE id = $1', [id]));
});

const discountOf = (p: { price: number; old_price: number | null } | null) =>
  p && p.old_price && Number(p.old_price) > Number(p.price) ? Math.round((1 - Number(p.price) / Number(p.old_price)) * 100) : 0;

adminCatalogRouter.put('/products/:id', async (req, res) => {
  const before = await one<{ price: number; old_price: number | null }>('SELECT price, old_price FROM products WHERE id = $1', [Number(req.params.id)]);
  const id = await saveProduct(Number(req.params.id), productSchema.parse(req.body));
  processStockAlerts().catch((err) => console.error('[stock-alerts]', err));
  const after = await one('SELECT * FROM products WHERE id = $1', [id]);
  // a new or deeper discount on an item people can buy goes to the Telegram channel
  if (after?.is_active && discountOf(after) > discountOf(before) && (await getSettings()).channel.postOnSale) {
    const stock = await one<{ n: number }>('SELECT COALESCE(SUM(stock), 0)::int AS n FROM product_variants WHERE product_id = $1', [id]);
    if (stock && stock.n > 0) scheduleAuto([{ productId: id, kind: 'sale' }]).catch((err) => console.error('[channel]', err));
  }
  res.json(after);
});

adminCatalogRouter.post('/products/:id/duplicate', async (req, res) => {
  const id = Number(req.params.id);
  const p = await one('SELECT * FROM products WHERE id = $1', [id]);
  if (!p) throw notFound('Товар не знайдено');
  const [images, variants] = await Promise.all([
    query('SELECT url, alt, color FROM product_images WHERE product_id = $1 ORDER BY sort_order, id', [id]),
    query('SELECT size, color, color_hex, sku, stock, price, cost_price FROM product_variants WHERE product_id = $1 ORDER BY sort_order, id', [id]),
  ]);
  const newId = await saveProduct(null, productSchema.parse({ ...p, name: `${p.name} (копія)`, slug: undefined, is_active: false, images, variants }));
  res.status(201).json({ id: newId });
});

adminCatalogRouter.post('/products/bulk', async (req, res) => {
  const b = z
    .object({ ids: z.array(z.number().int()).min(1), action: z.enum(['activate', 'deactivate', 'delete', 'feature', 'unfeature']) })
    .parse(req.body);
  const sql = {
    activate: 'UPDATE products SET is_active = true WHERE id = ANY($1)',
    deactivate: 'UPDATE products SET is_active = false WHERE id = ANY($1)',
    feature: 'UPDATE products SET is_featured = true WHERE id = ANY($1)',
    unfeature: 'UPDATE products SET is_featured = false WHERE id = ANY($1)',
    delete: 'DELETE FROM products WHERE id = ANY($1)',
  }[b.action];
  await query(sql, [b.ids]);
  if (b.action === 'activate') processStockAlerts().catch((err) => console.error('[stock-alerts]', err));
  res.json({ ok: true });
});

adminCatalogRouter.delete('/products/:id', async (req, res) => {
  await query('DELETE FROM products WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
});
