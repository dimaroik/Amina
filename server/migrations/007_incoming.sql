-- Shipments can announce their goods as "on the way" without taking pre-orders
ALTER TABLE shipments ADD COLUMN show_incoming BOOLEAN NOT NULL DEFAULT false;

-- Variants that are on the way in a shipment shown on the site (announced or open for pre-order)
CREATE VIEW variant_incoming AS
SELECT si.variant_id, SUM(si.quantity)::int AS qty, MIN(s.expected_at) AS eta
FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id
WHERE s.status = 'in_transit' AND (s.show_incoming OR s.preorder_enabled) AND si.variant_id IS NOT NULL
GROUP BY si.variant_id;
