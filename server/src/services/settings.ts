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

export interface Settings {
  store: StoreSettings;
  payment: PaymentSettings;
  notifications: NotificationSettings;
  chatbot: ChatbotSettings;
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
  },
  notifications: {
    adminEmails: [],
    telegramAdminChatIds: [],
    viberAdminIds: [],
    notifyCustomerEmail: true,
    notifyCustomerWhatsapp: false,
    notifyAdminOnChatHandoff: true,
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
