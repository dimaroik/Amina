-- Nova Poshta waybills (TTN) created from the admin panel
ALTER TABLE orders
  ADD COLUMN delivery_branch_ref TEXT NOT NULL DEFAULT '',
  ADD COLUMN np_ttn_ref          TEXT,
  ADD COLUMN np_status           TEXT NOT NULL DEFAULT '',
  ADD COLUMN np_status_code      TEXT NOT NULL DEFAULT '',
  ADD COLUMN np_status_at        TIMESTAMPTZ;
