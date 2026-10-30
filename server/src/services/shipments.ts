import { one, query } from '../db/pool.js';

export interface ShipmentRow {
  id: number;
  title: string;
  supplier: string;
  status: 'in_transit' | 'received';
  currency: 'USD' | 'CNY' | 'EUR' | 'UAH';
  exchange_rate: number;
  extra_cost: number;
  allocation: 'value' | 'quantity';
  tracking: string;
  note: string;
  ordered_at: string;
  expected_at: string | null;
  preorder_enabled: boolean;
  show_incoming: boolean;
  received_at: string | null;
  created_at: string;
}

export interface ShipmentItemRow {
  id: number;
  shipment_id: number;
  product_id: number | null;
  variant_id: number | null;
  name: string;
  size: string;
  color: string;
  quantity: number;
  unit_price: number;
  landed_cost: number | null;
  activate_on_receive: boolean;
  // joined
  image?: string | null;
  sale_price?: number | null;
  stock?: number | null;
  product_slug?: string | null;
  /** units of this variant already pre-ordered from the shipment */
  preordered?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Landed cost per unit in UAH: purchase price plus a share of shipping/fees, converted at the
 * shipment's rate. Extra costs are split by item value, or per unit when asked to (or when no
 * item has a price — then the extra cost is effectively the whole parcel price).
 */
export function computeShipment(s: ShipmentRow, items: ShipmentItemRow[]) {
  const units = items.reduce((n, i) => n + i.quantity, 0);
  const goods = items.reduce((n, i) => n + i.quantity * Number(i.unit_price), 0);
  const byValue = s.allocation === 'value' && goods > 0;
  const rate = Number(s.exchange_rate);
  const extra = Number(s.extra_cost);
  const lines = items.map((i) => {
    const share = units === 0 ? 0 : byValue ? (extra * Number(i.unit_price)) / goods : extra / units;
    const unitCost = round2((Number(i.unit_price) + share) * rate);
    const sale = i.sale_price ?? null;
    return {
      ...i,
      unit_cost: unitCost,
      total_cost: round2(unitCost * i.quantity),
      margin: sale !== null && sale > 0 ? round2(((sale - unitCost) / sale) * 100) : null,
      revenue: sale !== null ? round2(sale * i.quantity) : null,
    };
  });
  const totalUah = round2((goods + extra) * rate);
  const revenue = lines.reduce((n, l) => n + (l.revenue ?? 0), 0);
  return {
    items: lines,
    totals: {
      units,
      goods: round2(goods),
      extra: round2(extra),
      total: round2(goods + extra),
      total_uah: totalUah,
      avg_unit_uah: units ? round2(totalUah / units) : 0,
      expected_revenue: round2(revenue),
      expected_profit: round2(revenue - totalUah),
      margin: revenue > 0 ? round2(((revenue - totalUah) / revenue) * 100) : null,
    },
  };
}

export async function loadShipment(id: number) {
  const s = await one<ShipmentRow>('SELECT * FROM shipments WHERE id = $1', [id]);
  if (!s) return null;
  const [items, preorders] = await Promise.all([
    query<ShipmentItemRow>(
      `SELECT si.*, COALESCE(v.price, p.price) AS sale_price, v.stock, p.slug AS product_slug,
         (SELECT url FROM product_images WHERE product_id = si.product_id ORDER BY sort_order, id LIMIT 1) AS image,
         COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id
           WHERE oi.preorder_shipment_id = si.shipment_id AND oi.variant_id = si.variant_id
             AND o.status NOT IN ('cancelled', 'returned')), 0)::int AS preordered
       FROM shipment_items si
       LEFT JOIN product_variants v ON v.id = si.variant_id
       LEFT JOIN products p ON p.id = si.product_id
       WHERE si.shipment_id = $1 ORDER BY si.id`,
      [id],
    ),
    preorderOrders(id),
  ]);
  return { ...s, ...computeShipment(s, items), preorders };
}

/** Official NBU rate for a currency (UAH per unit). */
export async function nbuRate(currency: string): Promise<{ rate: number; date: string }> {
  if (currency === 'UAH') return { rate: 1, date: new Date().toISOString().slice(0, 10) };
  const res = await fetch(`https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=${encodeURIComponent(currency)}&json`, {
    signal: AbortSignal.timeout(10_000),
  });
  const [row] = (await res.json()) as { rate: number; exchangedate: string }[];
  if (!row?.rate) throw new Error('НБУ не повернув курс');
  return { rate: row.rate, date: row.exchangedate };
}

/** Orders that pre-ordered goods from a shipment (cancelled ones excluded). */
export function preorderOrders(shipmentId: number) {
  return query<{ id: number; number: string; customer_name: string; status: string; created_at: string; quantity: number }>(
    `SELECT o.id, o.number, o.customer_name, o.status, o.created_at, SUM(oi.quantity)::int AS quantity
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE oi.preorder_shipment_id = $1 AND o.status NOT IN ('cancelled', 'returned')
     GROUP BY o.id ORDER BY o.created_at`,
    [shipmentId],
  );
}
