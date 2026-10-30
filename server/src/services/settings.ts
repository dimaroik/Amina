import { one, query } from '../db/pool.js';

export interface StoreSettings {
  name: string;
  tagline: string;
  phone: string;
  email: string;
  address: string;
  workHours: string;
  instagram: string;
  telegram: string;
  viber: string;
  whatsapp: string;
  facebook: string;
  tiktok: string;
  about: string;
  announcement: string;
  currency: string;
}

export interface PaymentSettings {
  monoJarUrl: string;
  iban: string;
  recipient: string;
  edrpou: string;
  bankName: string;
  paymentPurpose: string;
  /** cash on delivery is switched off for a phone after this many parcels were not picked up (0 — never) */
  codBlockAfterRefusals: number;
}

export interface NotificationSettings {
  adminEmails: string[];
  telegramAdminChatIds: string[];
  viberAdminIds: string[];
  notifyCustomerEmail: boolean;
  notifyCustomerWhatsapp: boolean;
  notifyAdminOnChatHandoff: boolean;
}

export interface ChatbotSettings {
  enabled: boolean;
  botName: string;
  greeting: string;
  instructions: string;
}

export interface AnalyticsSettings {
  ga4Id: string;
  metaPixelId: string;
}

export interface NovaPoshtaSettings {
  senderCityRef: string;
  senderCityName: string;
  senderWarehouseRef: string;
  senderWarehouseName: string;
  senderPhone: string;
  defaultWeight: number;
  defaultDescription: string;
  payer: 'Recipient' | 'Sender';
  autoTrack: boolean;
}

export interface ChannelSettings {
  /** @channelname or numeric id of the store's Telegram channel (the bot must be its admin) */
  chatId: string;
  postOnReceive: boolean;
  postOnAnnounce: boolean;
  buttonText: string;
  /** '' — automatic posts go out right away; 'HH:MM' — they wait for that time (Kyiv) */
  autoTime: string;
  /** products with 2+ photos are posted as an album of up to 4 */
  album: boolean;
  postOnSale: boolean;
  /** a product added by hand is posted once it is on, has a photo and is in stock */
  postOnCreate: boolean;
  /** stock changed by hand from 0 to more → «Знову в наявності» */
  postOnRestock: boolean;
  /** minutes to wait after the last save of a hand-made product (more edits push it back) */
  manualDelay: number;
  /** automatic posts and the weekly digest go to the Telegram channel */
  telegramAuto: boolean;
  digestEnabled: boolean;
  /** ISO weekday: 1 — Monday … 7 — Sunday */
  digestDay: number;
  digestTime: string;
}

export interface SocialSettings {
  /** automatic posts (same events and time as the Telegram channel) also go to these networks */
  instagram: boolean;
  facebook: boolean;
  hashtags: string;
}

export interface Settings {
  store: StoreSettings;
  payment: PaymentSettings;
  notifications: NotificationSettings;
  chatbot: ChatbotSettings;
  analytics: AnalyticsSettings;
  novaPoshta: NovaPoshtaSettings;
  channel: ChannelSettings;
  social: SocialSettings;
}

export const defaultSettings: Settings = {
  store: {
    name: 'Amina',
    tagline: 'Сучасний жіночий одяг',
    phone: '+380 00 000 00 00',
    email: 'hello@amina.store',
    address: 'Україна',
    workHours: 'Пн–Сб, 10:00–19:00',
    instagram: '',
    telegram: '',
    viber: '',
    whatsapp: '',
    facebook: '',
    tiktok: '',
    about:
      'Amina — це бренд для жінок, які цінують якість, мінімалізм і комфорт. Ми ретельно відбираємо тканини та створюємо речі, які легко поєднуються між собою.',
    announcement: 'Безкоштовна доставка від 2500 ₴',
    currency: 'UAH',
  },
  payment: {
    monoJarUrl: '',
    iban: '',
    recipient: '',
    edrpou: '',
    bankName: 'monobank',
    paymentPurpose: 'Оплата замовлення {number}',
    codBlockAfterRefusals: 2,
  },
  notifications: {
    adminEmails: [],
    telegramAdminChatIds: [],
    viberAdminIds: [],
    notifyCustomerEmail: true,
    notifyCustomerWhatsapp: false,
    notifyAdminOnChatHandoff: true,
  },
  analytics: {
    ga4Id: '',
    metaPixelId: '',
  },
  novaPoshta: {
    senderCityRef: '',
    senderCityName: '',
    senderWarehouseRef: '',
    senderWarehouseName: '',
    senderPhone: '',
    defaultWeight: 1,
    defaultDescription: 'Одяг',
    payer: 'Recipient',
    autoTrack: true,
  },
  channel: {
    chatId: '',
    postOnReceive: true,
    postOnAnnounce: true,
    buttonText: 'Замовити на сайті',
    autoTime: '',
    album: true,
    postOnSale: true,
    postOnCreate: true,
    postOnRestock: true,
    manualDelay: 15,
    telegramAuto: true,
    digestEnabled: true,
    digestDay: 5,
    digestTime: '18:00',
  },
  social: {
    instagram: true,
    facebook: true,
    hashtags: '#amina #одяг #стиль #новинки',
  },
  chatbot: {
    enabled: true,
    botName: 'Аміна',
    greeting: 'Вітаю! Я віртуальна помічниця Amina. Допоможу з розміром, доставкою, оплатою чи статусом замовлення 🤍',
    instructions: '',
  },
};

type Key = keyof Settings;
let cache: Settings | null = null;

export async function getSettings(): Promise<Settings> {
  if (cache) return cache;
  const rows = await query<{ key: string; value: any }>('SELECT key, value FROM settings');
  const result = structuredClone(defaultSettings) as Settings;
  for (const row of rows) {
    if (row.key in result) {
      const k = row.key as Key;
      (result as any)[k] = { ...(result as any)[k], ...row.value };
    }
  }
  cache = result;
  return result;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  for (const key of Object.keys(patch) as Key[]) {
    if (!(key in defaultSettings)) continue;
    const merged = { ...current[key], ...(patch[key] as object) };
    await one(
      `INSERT INTO settings(key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(merged)],
    );
  }
  cache = null;
  return getSettings();
}
