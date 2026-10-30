-- Cash on delivery control: what the customer pays at the branch and whether the money came back
ALTER TABLE orders ADD COLUMN cod_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN cod_status TEXT NOT NULL DEFAULT 'none'
  CHECK (cod_status IN ('none', 'awaiting', 'collected', 'paid_out', 'refused'));
ALTER TABLE orders ADD COLUMN cod_paid_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN refused_at TIMESTAMPTZ;
CREATE INDEX orders_cod_idx ON orders(cod_status) WHERE cod_status <> 'none';
CREATE INDEX orders_phone_key_idx ON orders((right(regexp_replace(customer_phone, '\D', '', 'g'), 9)));

-- Per-phone flags (last 9 digits), e.g. "prepayment only" after parcels were not picked up
CREATE TABLE customer_flags (
  phone_key   TEXT PRIMARY KEY,
  prepay_only BOOLEAN NOT NULL DEFAULT false,
  note        TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Products published to the store's Telegram channel
CREATE TABLE telegram_posts (
  id         SERIAL PRIMARY KEY,
  product_id INT REFERENCES products(id) ON DELETE CASCADE,
  chat_id    TEXT NOT NULL,
  message_id BIGINT,
  kind       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX telegram_posts_product_idx ON telegram_posts(product_id, created_at DESC);
