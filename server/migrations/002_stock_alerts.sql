-- "Notify me when back in stock" subscriptions
CREATE TABLE stock_alerts (
  id               SERIAL PRIMARY KEY,
  variant_id       INT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  email            TEXT NOT NULL DEFAULT '',
  telegram_chat_id TEXT,
  token            TEXT NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at      TIMESTAMPTZ
);
CREATE INDEX stock_alerts_pending_idx ON stock_alerts(variant_id) WHERE notified_at IS NULL;
