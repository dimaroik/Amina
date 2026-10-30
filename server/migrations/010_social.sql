-- Instagram and Facebook alongside the Telegram channel
ALTER TABLE channel_queue ADD COLUMN target TEXT NOT NULL DEFAULT 'telegram' CHECK (target IN ('telegram', 'instagram', 'facebook'));
ALTER TABLE telegram_posts ADD COLUMN target TEXT NOT NULL DEFAULT 'telegram';
ALTER TABLE telegram_posts ADD COLUMN external_id TEXT;

-- Tokens of connected accounts; never sent to the browser
CREATE TABLE secrets (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
