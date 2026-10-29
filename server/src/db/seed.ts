import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from '../utils/slug.js';
import { bootstrap } from './bootstrap.js';
import { migrate } from './migrate.js';
import { one, pool, query } from './pool.js';

const SIZES = ['XS', 'S', 'M', 'L', 'XL'];

const tree: { name: string; children: string[] }[] = [
  { name: 'Сукні', children: ['Міні', 'Міді', 'Максі'] },
  { name: 'Верхній одяг', children: ['Пальта', 'Жакети'] },
  { name: 'Топи та блузи', children: ['Блузи', 'Футболки', 'Светри'] },
  { name: 'Низ', children: ['Штани', 'Спідниці'] },
];

type Demo = [name: string, category: string, image: string, price: number, oldPrice: number | null, colors: [string, string][], featured?: boolean];

const products: Demo[] = [
  ['Сукня міді з льону', 'Міді', 'dress-linen', 2890, null, [['Пісочний', '#c9b8a3'], ['Чорний', '#2f2c28']], true],
  ['Сукня-сорочка чорна', 'Міні', 'dress-black', 2490, 2990, [['Чорний', '#2f2c28']], true],
  ['Сукня максі теракотова', 'Максі', 'dress-terracotta', 3290, null, [['Теракота', '#b9998c']]],
  ['Блуза з бавовни oversize', 'Блузи', 'blouse-white', 1690, null, [['Молочний', '#e4d9c8'], ['Пісочний', '#c9b8a3']], true],
  ['Блуза шовкова', 'Блузи', 'blouse-sand', 2190, 2590, [['Капучино', '#a28c76']]],
  ['Штани палаццо', 'Штани', 'trousers-wide', 2390, null, [['Чорний', '#2f2c28'], ['Графіт', '#4a4f57']], true],
  ['Штани з високою посадкою', 'Штани', 'trousers-olive', 2190, null, [['Оливковий', '#7d8270']]],
  ['Жакет подовжений', 'Жакети', 'blazer-beige', 3890, null, [['Бежевий', '#c9b8a3']], true],
  ['Жакет приталений', 'Жакети', 'blazer-graphite', 3590, 4290, [['Графіт', '#4a4f57']]],
  ['Спідниця міді плісе', 'Спідниці', 'skirt-midi', 1990, null, [['Капучино', '#a28c76']]],
  ['Спідниця атласна', 'Спідниці', 'skirt-satin', 2290, null, [['Шоколад', '#8b6f58'], ['Молочний', '#e4d9c8']], true],
  ['Светр з мериносу', 'Светри', 'knit-cream', 2790, null, [['Молочний', '#e4d9c8']], true],
  ['Кардиган в рубчик', 'Светри', 'knit-mocha', 2590, 2990, [['Мокко', '#8b6f58']]],
  ['Пальто з вовни', 'Пальта', 'coat-camel', 6490, null, [['Кемел', '#a28c76']], true],
  ['Пальто oversize чорне', 'Пальта', 'coat-black', 6890, 7990, [['Чорний', '#2f2c28']]],
  ['Футболка базова', 'Футболки', 'tee-basic', 790, null, [['Молочний', '#e4d9c8'], ['Чорний', '#2f2c28']]],
  ['Футболка з щільного трикотажу', 'Футболки', 'tee-graphite', 990, null, [['Графіт', '#4a4f57']]],
];

async function seed() {
  await migrate();
  await bootstrap();
  const existing = await one<{ n: number }>('SELECT COUNT(*) AS n FROM products');
  if ((existing?.n ?? 0) > 0) {
    console.log('[seed] products already exist — skipping demo catalog');
    return;
  }
  const catIds = new Map<string, number>();
  for (const [i, root] of tree.entries()) {
    const r = await one('INSERT INTO categories(name, slug, sort_order, description) VALUES ($1,$2,$3,$4) RETURNING id', [
      root.name, slugify(root.name), i, `Колекція «${root.name}» від Amina`,
    ]);
    catIds.set(root.name, r.id);
    for (const [j, child] of root.children.entries()) {
      const c = await one('INSERT INTO categories(name, slug, parent_id, sort_order) VALUES ($1,$2,$3,$4) RETURNING id', [
        child, slugify(`${root.name} ${child}`), r.id, j,
      ]);
      catIds.set(child, c.id);
    }
  }
  for (const [i, [name, cat, image, price, oldPrice, colors, featured]] of products.entries()) {
    const p = await one(
      `INSERT INTO products(name, slug, category_id, sku, description, composition, care, price, old_price, is_featured, is_new, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() - ($12 || ' hours')::interval) RETURNING id`,
      [
        name, slugify(name), catIds.get(cat), `AM-${String(100 + i)}`,
        'Лаконічна модель з якісної тканини, яка легко поєднується з базовим гардеробом. Вільний, але акуратний силует, продумані деталі та приємна до тіла фактура.',
        '70% бавовна, 30% льон', 'Делікатне прання при 30°C. Не відбілювати. Прасувати при середній температурі.',
        price, oldPrice, Boolean(featured), i % 3 === 0, i * 7,
      ],
    );
    await query('INSERT INTO product_images(product_id, url, sort_order) VALUES ($1,$2,0), ($1,$3,1)', [p.id, `/demo/${image}-1.svg`, `/demo/${image}-2.svg`]);
    let order = 0;
    for (const [color, hex] of colors) {
      for (const size of SIZES) {
        const stock = (i + order) % 7 === 0 ? 0 : ((i * 3 + order) % 6) + 1;
        await query('INSERT INTO product_variants(product_id, size, color, color_hex, stock, sort_order, sku) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
          p.id, size, color, hex, stock, order++, `AM-${100 + i}-${size}`,
        ]);
      }
    }
  }
  await query(`INSERT INTO banners(title, subtitle, image_url, link, button_text, sort_order) VALUES
    ('Нова колекція', 'Природні тканини, спокійні відтінки та бездоганний крій', '/demo/hero-1.svg', '/catalog', 'Дивитися колекцію', 0),
    ('Осінній гардероб', 'Пальта й жакети, які стануть основою сезону', '/demo/hero-2.svg', '/catalog/verkhnii-odiah', 'Обрати верхній одяг', 1)`);
  await query(`INSERT INTO promo_codes(code, type, value, min_total) VALUES ('WELCOME10', 'percent', 10, 1000) ON CONFLICT DO NOTHING`);
  console.log(`[seed] demo catalog created: ${products.length} products`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  seed()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
