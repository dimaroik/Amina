-- Purchase shipments (e.g. parcels from China) and landed cost per unit
CREATE TABLE shipments (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  supplier      TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit', 'received')),
  currency      TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'CNY', 'EUR', 'UAH')),
  exchange_rate NUMERIC(12,4) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  extra_cost    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (extra_cost >= 0),
  allocation    TEXT NOT NULL DEFAULT 'value' CHECK (allocation IN ('value', 'quantity')),
  tracking      TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  ordered_at    DATE NOT NULL DEFAULT current_date,
  received_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE shipment_items (
  id              SERIAL PRIMARY KEY,
  shipment_id     INT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  product_id      INT REFERENCES products(id) ON DELETE SET NULL,
  variant_id      INT REFERENCES product_variants(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  size            TEXT NOT NULL DEFAULT '',
  color           TEXT NOT NULL DEFAULT '',
  quantity        INT NOT NULL CHECK (quantity > 0),
  unit_price      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  landed_cost     NUMERIC(12,2),
  -- products created from the shipment stay hidden until it is received
  activate_on_receive BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX shipment_items_shipment_idx ON shipment_items(shipment_id);

-- latest landed cost of a variant, and a snapshot of it on every sold item
ALTER TABLE product_variants ADD COLUMN cost_price NUMERIC(12,2);
ALTER TABLE order_items ADD COLUMN cost_price NUMERIC(12,2);
