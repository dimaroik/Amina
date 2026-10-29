import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { one, query } from '../db/pool.js';
import { listProducts } from '../routes/catalog.js';
import { money, orderStatusLabel, paymentStatusLabel, type OrderStatus, type PaymentStatus } from './labels.js';
import { fireAndForget, notifyChatHandoff } from './notify/index.js';
import { getSettings } from './settings.js';

type MessageParam = Anthropic.Beta.BetaMessageParam;

export interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
  products?: ProductCard[];
  at: string;
}

interface ProductCard {
  id: number;
  name: string;
  slug: string;
  price: number;
  old_price: number | null;
  images: string[];
}

interface ChatSession {
  id: string;
  messages: MessageParam[];
  transcript: TranscriptEntry[];
  needs_human: boolean;
  contact: string;
}

const MAX_USER_TURNS = 40;
const client = config.anthropic.enabled ? new Anthropic() : null;

const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: 'search_products',
    description:
      'Search the Amina catalog. Returns up to 6 active products with price, sizes in stock and colours. Matching products are shown to the customer as clickable cards under your reply, so do not paste links.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords in Ukrainian, e.g. "сукня льон" or "піджак"' },
        category_slug: { type: 'string', description: 'Category slug from list_categories' },
        max_price: { type: 'number', description: 'Maximum price in UAH' },
        size: { type: 'string', description: 'Size that must be in stock, e.g. "M"' },
        on_sale: { type: 'boolean', description: 'Only discounted items' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_categories',
    description: 'List catalog categories and subcategories with their slugs.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_order_status',
    description:
      'Look up an order. Requires the order number (format AM-1234) and the phone number used at checkout; never reveal anything if they do not match.',
    input_schema: {
      type: 'object',
      properties: {
        order_number: { type: 'string' },
        phone: { type: 'string' },
      },
      required: ['order_number', 'phone'],
      additionalProperties: false,
    },
  },
  {
    name: 'request_manager',
    description:
      'Hand the conversation to a human manager. Use when the customer asks for a person, has a complaint, a return/exchange, or a question you cannot answer. Ask for a phone number or messenger contact first.',
    input_schema: {
      type: 'object',
      properties: {
        contact: { type: 'string', description: 'Phone, Telegram or email of the customer' },
        summary: { type: 'string', description: 'Short summary of what the customer needs, in Ukrainian' },
      },
      required: ['contact', 'summary'],
      additionalProperties: false,
    },
  },
];

async function systemPrompt(): Promise<string> {
  const [s, faq, delivery, payments] = await Promise.all([
    getSettings(),
    query('SELECT question, answer FROM faq_items WHERE is_active ORDER BY sort_order, id'),
    query('SELECT name, description, price, free_from FROM delivery_methods WHERE is_active ORDER BY sort_order'),
    query('SELECT name, description FROM payment_methods WHERE is_active ORDER BY sort_order'),
  ]);
  return `You are ${s.chatbot.botName}, the friendly online shopping assistant of "${s.store.name}" — a Ukrainian clothing store (${s.store.tagline}).
Speak Ukrainian by default; switch to the customer's language if they write in another one. Be warm, concise and stylish: 1–4 short sentences, plain text, no markdown headings or tables. Emojis sparingly.

You help customers choose clothes and sizes, explain delivery, payment, returns, and check order status. Use the tools to look up real products and orders — never invent products, prices, stock or order details. If you do not know something, offer to connect a manager (request_manager).

Store information:
- Phone: ${s.store.phone}; email: ${s.store.email}; working hours: ${s.store.workHours}; address: ${s.store.address}
- Instagram: ${s.store.instagram || '—'}; Telegram: ${s.store.telegram || '—'}; Viber: ${s.store.viber || '—'}
- About: ${s.store.about}

Delivery options:
${delivery.map((d) => `- ${d.name}: ${d.price > 0 ? money(d.price) : 'за тарифами перевізника'}${d.free_from ? `, безкоштовно від ${money(d.free_from)}` : ''}. ${d.description}`).join('\n')}

Payment options:
${payments.map((p) => `- ${p.name}. ${p.description}`).join('\n')}

FAQ (authoritative answers):
${faq.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')}
${s.chatbot.instructions ? `\nAdditional instructions from the store owner:\n${s.chatbot.instructions}` : ''}`;
}

async function runTool(session: ChatSession, name: string, input: any, found: ProductCard[]): Promise<string> {
  switch (name) {
    case 'search_products': {
      const result = await listProducts({
        q: input.query || undefined,
        category: input.category_slug || undefined,
        maxPrice: typeof input.max_price === 'number' ? input.max_price : undefined,
        sizes: input.size || undefined,
        sale: input.on_sale ? '1' : undefined,
        sort: 'popular',
        page: 1,
        limit: 6,
      });
      found.splice(0, found.length, ...result.items.map((p: any) => ({
        id: p.id, name: p.name, slug: p.slug, price: p.price, old_price: p.old_price, images: p.images,
      })));
      if (!result.items.length) return 'No products found. Suggest broader search or other categories.';
      return JSON.stringify(
        result.items.map((p: any) => ({
          name: p.name,
          price: p.price,
          old_price: p.old_price,
          sizes: p.sizes,
          colors: p.colors.map((c: any) => c.name),
          in_stock: p.in_stock,
          category: p.category_name,
        })),
      );
    }
    case 'list_categories': {
      const rows = await query(
        `SELECT c.name, c.slug, pc.name AS parent FROM categories c LEFT JOIN categories pc ON pc.id = c.parent_id
         WHERE c.is_active ORDER BY pc.sort_order NULLS FIRST, c.sort_order`,
      );
      return JSON.stringify(rows);
    }
    case 'get_order_status': {
      const digits = (s: string) => String(s ?? '').replace(/\D/g, '').slice(-9);
      const order = await one('SELECT * FROM orders WHERE upper(number) = upper($1)', [String(input.order_number ?? '').trim()]);
      if (!order || digits(order.customer_phone) !== digits(input.phone) || digits(input.phone).length < 9) {
        return 'Order not found or phone does not match.';
      }
      const items = await query('SELECT name, size, quantity FROM order_items WHERE order_id = $1', [order.id]);
      return JSON.stringify({
        number: order.number,
        status: orderStatusLabel[order.status as OrderStatus],
        payment: paymentStatusLabel[order.payment_status as PaymentStatus],
        total: money(order.total),
        delivery: [order.delivery_name, order.delivery_city, order.delivery_branch].filter(Boolean).join(', '),
        tracking_number: order.tracking_number || null,
        created_at: order.created_at,
        items,
      });
    }
    case 'request_manager': {
      session.needs_human = true;
      session.contact = String(input.contact ?? '').slice(0, 200);
      fireAndForget(notifyChatHandoff(session.id, session.contact, String(input.summary ?? '').slice(0, 1000)));
      return 'Manager notified. Tell the customer a manager will contact them soon during working hours.';
    }
    default:
      return `Unknown tool ${name}`;
  }
}

async function askClaude(session: ChatSession, found: ProductCard[]): Promise<string> {
  const system = await systemPrompt();
  for (let i = 0; i < 6; i++) {
    const response = await client!.beta.messages.create({
      model: config.anthropic.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools,
      messages: session.messages,
    });

    if (response.stop_reason === 'refusal') {
      return 'Вибачте, з цим питанням я не можу допомогти. Можу з’єднати вас із менеджером.';
    }
    session.messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'pause_turn') continue;
    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || !toolUses.length) {
      return response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
    }
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const tool of toolUses) {
      try {
        results.push({ type: 'tool_result', tool_use_id: tool.id, content: await runTool(session, tool.name, tool.input, found) });
      } catch (err) {
        console.error('[chatbot tool]', err);
        results.push({ type: 'tool_result', tool_use_id: tool.id, content: 'Tool failed', is_error: true });
      }
    }
    session.messages.push({ role: 'user', content: results });
  }
  return 'Вибачте, я трохи заплуталась. Спробуйте переформулювати питання або зверніться до менеджера.';
}

/** Keyword-based fallback when no Anthropic API key is configured. */
async function answerOffline(session: ChatSession, text: string, found: ProductCard[]): Promise<string> {
  const s = await getSettings();
  const lower = text.toLowerCase();
  const orderMatch = text.match(/AM-?\d{3,}/i);
  const phoneMatch = text.match(/\+?\d[\d\s()-]{8,}\d/);
  if (orderMatch && phoneMatch) {
    const res = JSON.parse(
      (await runTool(session, 'get_order_status', { order_number: orderMatch[0].toUpperCase().replace(/^AM-?/, 'AM-'), phone: phoneMatch[0] }, found))
        .replace(/^Order not found.*/, '{}'),
    );
    if (res.number) {
      return `Замовлення ${res.number}: ${res.status.toLowerCase()}, ${res.payment.toLowerCase()}. Сума ${res.total}.${res.tracking_number ? ` ТТН: ${res.tracking_number}.` : ''}`;
    }
    return 'Не знайшла замовлення з таким номером і телефоном. Перевірте, будь ласка, дані.';
  }
  if (orderMatch || /замовлен|статус|де моя|посилк/.test(lower)) {
    return 'Щоб перевірити замовлення, напишіть його номер (AM-1234) і телефон, вказаний при оформленні.';
  }
  if (/менеджер|оператор|людин|зателефон|передзвон/.test(lower)) {
    if (phoneMatch) {
      await runTool(session, 'request_manager', { contact: phoneMatch[0], summary: text }, found);
      return `Дякую! Менеджер зв'яжеться з вами найближчим часом (${s.store.workHours}).`;
    }
    return 'Залиште, будь ласка, номер телефону — і менеджер вам зателефонує.';
  }
  const faq = await query<{ question: string; answer: string }>('SELECT question, answer FROM faq_items WHERE is_active');
  const words = lower.split(/[^a-zа-яіїєґ0-9]+/i).filter((w) => w.length > 3);
  let best: { score: number; answer: string } = { score: 0, answer: '' };
  for (const f of faq) {
    const hay = `${f.question} ${f.answer}`.toLowerCase();
    const score = words.reduce((n, w) => n + (hay.includes(w.slice(0, Math.max(4, w.length - 2))) ? 1 : 0), 0);
    if (score > best.score) best = { score, answer: f.answer };
  }
  if (best.score >= 2) return best.answer;
  // Crude stemming copes with Ukrainian inflection: "сукню" -> "сукн"
  for (const w of words) {
    await runTool(session, 'search_products', { query: w.slice(0, Math.max(4, w.length - 2)) }, found);
    if (found.length) return 'Ось що я знайшла в каталозі:';
  }
  if (best.score >= 1) return best.answer;
  return `Я ще вчуся 🙂 Спробуйте запитати про доставку, оплату, розміри чи статус замовлення — або напишіть нам: ${s.store.phone}.`;
}

export async function chat(sessionId: string | undefined, text: string) {
  let session: ChatSession | null = sessionId
    ? await one<ChatSession>('SELECT id, messages, transcript, needs_human, contact FROM chat_sessions WHERE id = $1', [sessionId])
    : null;
  if (!session) {
    session = { id: randomUUID(), messages: [], transcript: [], needs_human: false, contact: '' };
    await query('INSERT INTO chat_sessions(id) VALUES ($1)', [session.id]);
  }
  if (session.transcript.filter((t) => t.role === 'user').length >= MAX_USER_TURNS) {
    return { sessionId: session.id, reply: { role: 'assistant', text: 'Ми вже довго спілкуємося 🙂 Будь ласка, зв’яжіться з менеджером напряму.', at: new Date().toISOString() } };
  }

  const found: ProductCard[] = [];
  session.transcript.push({ role: 'user', text, at: new Date().toISOString() });
  let replyText: string;
  if (client) {
    const before = session.messages.length;
    session.messages.push({ role: 'user', content: text });
    try {
      replyText = await askClaude(session, found);
    } catch (err) {
      console.error('[chatbot]', err);
      // Drop this failed turn from the API history so the next request starts from a complete one
      session.messages.length = before;
      replyText = await answerOffline(session, text, found);
    }
  } else {
    replyText = await answerOffline(session, text, found);
  }

  const reply: TranscriptEntry = { role: 'assistant', text: replyText || '…', products: found.length ? found : undefined, at: new Date().toISOString() };
  session.transcript.push(reply);
  await query(
    'UPDATE chat_sessions SET messages = $2, transcript = $3, needs_human = $4, contact = $5, updated_at = now() WHERE id = $1',
    [session.id, JSON.stringify(session.messages), JSON.stringify(session.transcript), session.needs_human, session.contact],
  );
  return { sessionId: session.id, reply };
}

export async function getTranscript(sessionId: string): Promise<TranscriptEntry[] | null> {
  const row = await one<{ transcript: TranscriptEntry[] }>('SELECT transcript FROM chat_sessions WHERE id = $1', [sessionId]);
  return row?.transcript ?? null;
}
