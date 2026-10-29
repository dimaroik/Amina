-- Amina: initial schema

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE images (
  id         UUID PRIMARY KEY,
  mime       TEXT NOT NULL,
  data       BYTEA NOT NULL,
  width      INT,
  height     INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id           SERIAL PRIMARY KEY,
  parent_id    INT REFERENCES categories(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  description  TEXT NOT NULL DEFAULT '',
  image_url    TEXT,
  sort_order   INT NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  show_in_menu BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX categories_parent_idx ON categories(parent_id);

CREATE TABLE products (
  id          SERIAL PRIMARY KEY,
  category_id INT REFERENCES categories(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  sku         TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  composition TEXT NOT NULL DEFAULT '',
  care        TEXT NOT NULL DEFAULT '',
  price       NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  old_price   NUMERIC(10,2),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  is_new      BOOLEAN NOT NULL DEFAULT true,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  sales_count INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX products_category_idx ON products(category_id);
CREATE INDEX products_active_idx ON products(is_active, created_at DESC);

CREATE TABLE product_images (
  id         SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  alt        TEXT NOT NULL DEFAULT '',
  color      TEXT,
  sort_order INT NOT NULL DEFAULT 0
);
CREATE INDEX product_images_product_idx ON product_images(product_id, sort_order);

CREATE TABLE product_variants (
  id         SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size       TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT '',
  color_hex  TEXT,
  sku        TEXT NOT NULL DEFAULT '',
  stock      INT NOT NULL DEFAULT 0,
  price      NUMERIC(10,2),
  sort_order INT NOT NULL DEFAULT 0
);
CREATE INDEX product_variants_product_idx ON product_variants(product_id);

CREATE TABLE delivery_methods (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL CHECK (type IN ('np_warehouse', 'np_courier', 'address', 'pickup')),
  price       NUMERIC(10,2) NOT NULL DEFAULT 0,
  free_from   NUMERIC(10,2),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0
);

CREATE TABLE payment_methods (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL CHECK (code IN ('cod', 'mono_jar', 'iban', 'mono_acquiring')),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0
);

CREATE TABLE promo_codes (
  id         SERIAL PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  type       TEXT NOT NULL CHECK (type IN ('percent', 'fixed')),
  value      NUMERIC(10,2) NOT NULL,
  min_total  NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_uses   INT,
  used_count INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE order_number_seq START 1001;

CREATE TABLE orders (
  id                  SERIAL PRIMARY KEY,
  number              TEXT NOT NULL UNIQUE,
  access_token        TEXT NOT NULL,
  user_id             INT REFERENCES users(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new', 'confirmed', 'processing', 'shipped', 'delivered', 'completed', 'cancelled', 'returned')),
  payment_status      TEXT NOT NULL DEFAULT 'pending'
                      CHECK (payment_status IN ('pending', 'awaiting', 'paid', 'refunded', 'failed')),
  customer_name       TEXT NOT NULL,
  customer_phone      TEXT NOT NULL,
  customer_email      TEXT NOT NULL DEFAULT '',
  contact_channel     TEXT NOT NULL DEFAULT 'phone',
  delivery_method_id  INT REFERENCES delivery_methods(id) ON DELETE SET NULL,
  delivery_name       TEXT NOT NULL DEFAULT '',
  delivery_type       TEXT NOT NULL DEFAULT '',
  delivery_city       TEXT NOT NULL DEFAULT '',
  delivery_city_ref   TEXT NOT NULL DEFAULT '',
  delivery_branch     TEXT NOT NULL DEFAULT '',
  delivery_address    TEXT NOT NULL DEFAULT '',
  delivery_cost       NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_method      TEXT NOT NULL,
  payment_name        TEXT NOT NULL DEFAULT '',
  payment_invoice_id  TEXT,
  payment_url         TEXT,
  subtotal            NUMERIC(10,2) NOT NULL,
  discount            NUMERIC(10,2) NOT NULL DEFAULT 0,
  total               NUMERIC(10,2) NOT NULL,
  promo_code          TEXT,
  comment             TEXT NOT NULL DEFAULT '',
  admin_note          TEXT NOT NULL DEFAULT '',
  tracking_number     TEXT NOT NULL DEFAULT '',
  telegram_chat_id    TEXT,
  viber_user_id       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX orders_created_idx ON orders(created_at DESC);
CREATE INDEX orders_status_idx ON orders(status);
CREATE INDEX orders_phone_idx ON orders(customer_phone);

CREATE TABLE order_items (
  id         SERIAL PRIMARY KEY,
  order_id   INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id) ON DELETE SET NULL,
  variant_id INT REFERENCES product_variants(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  sku        TEXT NOT NULL DEFAULT '',
  size       TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT '',
  image_url  TEXT,
  price      NUMERIC(10,2) NOT NULL,
  quantity   INT NOT NULL CHECK (quantity > 0)
);
CREATE INDEX order_items_order_idx ON order_items(order_id);

CREATE TABLE order_history (
  id         SERIAL PRIMARY KEY,
  order_id   INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  author     TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX order_history_order_idx ON order_history(order_id, created_at);

CREATE TABLE notification_log (
  id         SERIAL PRIMARY KEY,
  order_id   INT REFERENCES orders(id) ON DELETE CASCADE,
  channel    TEXT NOT NULL,
  recipient  TEXT NOT NULL DEFAULT '',
  subject    TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL,
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE banners (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  subtitle    TEXT NOT NULL DEFAULT '',
  image_url   TEXT NOT NULL,
  link        TEXT NOT NULL DEFAULT '',
  button_text TEXT NOT NULL DEFAULT '',
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE faq_items (
  id         SERIAL PRIMARY KEY,
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE chat_sessions (
  id            UUID PRIMARY KEY,
  messages      JSONB NOT NULL DEFAULT '[]',
  transcript    JSONB NOT NULL DEFAULT '[]',
  needs_human   BOOLEAN NOT NULL DEFAULT false,
  contact       TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX chat_sessions_updated_idx ON chat_sessions(updated_at DESC);

CREATE TABLE subscribers (
  id         SERIAL PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
