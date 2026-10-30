-- Product reviews with photos, published after moderation
CREATE TABLE reviews (
  id          SERIAL PRIMARY KEY,
  product_id  INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text        TEXT NOT NULL DEFAULT '',
  size        TEXT NOT NULL DEFAULT '',
  height      SMALLINT,
  fit         TEXT CHECK (fit IN ('small', 'true', 'large')),
  photos      TEXT[] NOT NULL DEFAULT '{}',
  verified    BOOLEAN NOT NULL DEFAULT false,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_reply TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reviews_product_idx ON reviews(product_id, status, created_at DESC);
CREATE INDEX reviews_status_idx ON reviews(status, created_at DESC);
