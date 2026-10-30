-- Channel posts waiting for their time (scheduled by hand or held until the configured hour)
CREATE TABLE channel_queue (
  id         SERIAL PRIMARY KEY,
  product_id INT REFERENCES products(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  run_at     TIMESTAMPTZ NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  source     TEXT NOT NULL DEFAULT 'auto',
  attempts   INT NOT NULL DEFAULT 0,
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at    TIMESTAMPTZ
);
CREATE INDEX channel_queue_due_idx ON channel_queue(run_at) WHERE status = 'pending';

-- Small key/value state for background jobs (e.g. the date of the last weekly digest)
CREATE TABLE app_state (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
