import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { loadImage } from './images.js';

const client = config.anthropic.enabled ? new Anthropic() : null;

export const aiEnabled = () => client !== null;

export interface DraftInput {
  text: string;
  images: string[];
  colors: string[];
  sizes: string[];
}

const draftSchema = z.object({
  name: z.string(),
  description: z.string(),
  composition: z.string(),
  care: z.string(),
  category_id: z.number().int().nullable(),
  colors: z.array(z.string()),
  sizes: z.array(z.string()),
  tags: z.array(z.string()),
  notes: z.string(),
});
export type ProductDraft = z.infer<typeof draftSchema>;

const SYSTEM = `Ти — контент-менеджер українського інтернет-магазину жіночого одягу Amina (стриманий сучасний стиль).
Власниця закуповує речі на китайських маркетплейсах (Taobao, 1688, Pinduoduo) і додає їх у каталог.
За фото та текстом від постачальника (часто китайською, з машинним перекладом або SEO-сміттям) підготуй картку товару українською.

Правила:
- name: коротка природна назва, як у бутику, 2–5 слів, без брендів постачальника, артикулів, «2024 новинка», «хіт» тощо. Напр.: «Сукня-сорочка з льону», «Жакет oversize у клітинку».
- description: 2–4 речення живою мовою: силует, посадка, деталі, з чим поєднати. Без вигаданих фактів, без емодзі й капслоку.
- composition: склад тканини, якщо він є в тексті (переклади: 棉 — бавовна, 聚酯纤维 — поліестер, 粘纤 — віскоза, 氨纶 — еластан, 亚麻 — льон, 羊毛 — вовна). Якщо складу немає — порожній рядок, не вигадуй.
- care: короткі поради з догляду, що відповідають складу; якщо склад невідомий — порожній рядок.
- category_id: id найвідповіднішої категорії зі списку або null.
- colors і sizes: тільки значення з дозволених списків, що справді є у товару (за текстом або фото). Якщо незрозуміло — порожній масив.
- tags: 3–6 коротких тегів малими літерами для пошуку (тканина, стиль, сезон).
- notes: одне речення для власниці — що варто перевірити (напр. «Склад не вказано — уточніть у продавця»), або порожній рядок.`;

const MEDIA: Record<string, 'image/webp' | 'image/png' | 'image/jpeg' | 'image/gif'> = {
  'image/webp': 'image/webp',
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/gif': 'image/gif',
};

/** Drafts a product card (Ukrainian copy, category, colours, sizes) from supplier photos and text. */
export async function draftProduct(input: DraftInput): Promise<ProductDraft> {
  if (!client) throw new Error('AI disabled');
  const categories = await query<{ id: number; path: string }>(
    `WITH RECURSIVE tree AS (
       SELECT id, name::text AS path FROM categories WHERE parent_id IS NULL
       UNION ALL
       SELECT c.id, t.path || ' › ' || c.name FROM categories c JOIN tree t ON c.parent_id = t.id
     ) SELECT id, path FROM tree ORDER BY path`,
  );

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const url of input.images.slice(0, 4)) {
    const id = url.match(/\/api\/images\/([0-9a-f-]{36})/i)?.[1];
    const img = id ? await loadImage(id) : null;
    const mediaType = img && MEDIA[img.mime];
    if (img && mediaType) content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: img.data.toString('base64') } });
  }
  content.push({
    type: 'text',
    text: [
      `Категорії (id: шлях):\n${categories.map((c) => `${c.id}: ${c.path}`).join('\n') || '— немає —'}`,
      `Дозволені кольори: ${input.colors.join(', ')}`,
      `Дозволені розміри: ${input.sizes.join(', ')}`,
      `Текст від постачальника:\n${input.text.trim() || '(немає — орієнтуйся на фото)'}`,
    ].join('\n\n'),
  });

  const response = await client.beta.messages.create({
    model: config.anthropic.model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            composition: { type: 'string' },
            care: { type: 'string' },
            category_id: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            colors: { type: 'array', items: { type: 'string', enum: input.colors } },
            sizes: { type: 'array', items: { type: 'string', enum: input.sizes } },
            tags: { type: 'array', items: { type: 'string' } },
            notes: { type: 'string' },
          },
          required: ['name', 'description', 'composition', 'care', 'category_id', 'colors', 'sizes', 'tags', 'notes'],
          additionalProperties: false,
        },
      },
    },
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal') throw new Error('refusal');
  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('empty response');
  const draft = draftSchema.parse(JSON.parse(text.text));
  const known = new Set(categories.map((c) => c.id));
  return {
    ...draft,
    category_id: draft.category_id !== null && known.has(draft.category_id) ? draft.category_id : null,
    colors: draft.colors.filter((c) => input.colors.includes(c)),
    sizes: input.sizes.filter((s) => draft.sizes.includes(s)),
    tags: draft.tags.map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 8),
  };
}
