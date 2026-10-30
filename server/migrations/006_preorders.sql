-- Pre-orders from shipments that are still on the way
ALTER TABLE shipments ADD COLUMN preorder_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE shipments ADD COLUMN expected_at DATE;

-- an order line sold ahead of a shipment; stock is taken when the shipment is received
ALTER TABLE order_items ADD COLUMN preorder_shipment_id INT REFERENCES shipments(id) ON DELETE SET NULL;
CREATE INDEX order_items_preorder_idx ON order_items(preorder_shipment_id) WHERE preorder_shipment_id IS NOT NULL;

-- Units of a variant still free for pre-order in each open shipment
CREATE VIEW shipment_preorder_free AS
WITH cap AS (
  SELECT si.shipment_id, si.variant_id, SUM(si.quantity)::int AS qty, s.expected_at
  FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id
  WHERE s.status = 'in_transit' AND s.preorder_enabled AND si.variant_id IS NOT NULL
  GROUP BY si.shipment_id, si.variant_id, s.expected_at
), res AS (
  SELECT oi.preorder_shipment_id AS shipment_id, oi.variant_id, SUM(oi.quantity)::int AS qty
  FROM order_items oi JOIN orders o ON o.id = oi.order_id
  WHERE oi.preorder_shipment_id IS NOT NULL AND o.status NOT IN ('cancelled', 'returned')
  GROUP BY 1, 2
)
SELECT cap.shipment_id, cap.variant_id, cap.expected_at, GREATEST(0, cap.qty - COALESCE(res.qty, 0))::int AS free
FROM cap LEFT JOIN res ON res.shipment_id = cap.shipment_id AND res.variant_id = cap.variant_id;

CREATE VIEW variant_preorder AS
SELECT variant_id, SUM(free)::int AS available, MIN(expected_at) FILTER (WHERE free > 0) AS eta
FROM shipment_preorder_free GROUP BY variant_id;
