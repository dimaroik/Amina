const env = process.env;

function bool(v: string | undefined, def = false): boolean {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export const config = {
  port: Number(env.PORT ?? 3000),
  isProd: env.NODE_ENV === 'production',
  databaseUrl: env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/amina',
  databaseSsl: bool(env.DATABASE_SSL, /neon\.tech|sslmode=require/.test(env.DATABASE_URL ?? '')),
  jwtSecret: env.JWT_SECRET ?? 'dev-secret-change-me',
  publicUrl: (env.PUBLIC_URL ?? env.RENDER_EXTERNAL_URL ?? `http://localhost:${env.PORT ?? 3000}`).replace(/\/$/, ''),
  adminEmail: env.ADMIN_EMAIL ?? '',
  adminPassword: env.ADMIN_PASSWORD ?? '',
  seedDemo: bool(env.SEED_DEMO, false),

  mail: {
    from: env.MAIL_FROM ?? 'Amina <no-reply@amina.store>',
    resendApiKey: env.RESEND_API_KEY ?? '',
    smtpHost: env.SMTP_HOST ?? '',
    smtpPort: Number(env.SMTP_PORT ?? 587),
    smtpUser: env.SMTP_USER ?? '',
    smtpPass: env.SMTP_PASS ?? '',
  },
  telegram: {
    botToken: env.TELEGRAM_BOT_TOKEN ?? '',
    botUsername: env.TELEGRAM_BOT_USERNAME ?? '',
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET ?? '',
  },
  viber: {
    token: env.VIBER_BOT_TOKEN ?? '',
    botName: env.VIBER_BOT_NAME ?? 'Amina',
    botUri: env.VIBER_BOT_URI ?? '',
  },
  whatsapp: {
    token: env.WHATSAPP_TOKEN ?? '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    template: env.WHATSAPP_TEMPLATE ?? '',
    templateLang: env.WHATSAPP_TEMPLATE_LANG ?? 'uk',
  },
  monobank: {
    token: env.MONOBANK_TOKEN ?? '',
  },
  novaPoshtaApiKey: env.NOVA_POSHTA_API_KEY ?? '',
  anthropic: {
    enabled: Boolean(env.ANTHROPIC_API_KEY),
    model: env.CHATBOT_MODEL ?? 'claude-opus-5-5',
  },
};
