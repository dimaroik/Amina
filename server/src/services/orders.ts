import { one, query } from '../db/pool.js';

export interface OrderItemRow {
  id: number;
  product_id: number | null;
  variant_id: number | null;
  name: string;
  sku: string;
  size: string;
  color: string;
  image_url: string | null;
  price: number;
  quantity: number;
  preorder_shipment_id: number | null;
  /** still waiting for its shipment (stock is not taken yet) */
  preorder_pending: boolean;
  preorder_eta: string | null;
  preorder_shipment: string | null;
}

export type OrderRow = Record<string, any> & {
  id: number;
  number: string;
  access_token: string;
  status: string;
  payment_status: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  total: number;
  subtotal: number;
  discount: number;
  delivery_cost: number;
  payment_method: string;
  telegram_chat_id: string | null;
  viber_user_id: string | null;
  items: OrderItemRow[];
};

export async function getOrderFull(id: number): Promise<OrderRow | null> {
  const order = await one<OrderRow>('SELECT * FROM orders WHERE id = $1', [id]);
  if (!order) return null;
  order.items = await query<OrderItemRow>(
    `SELECT oi.*, COALESCE(s.status = 'in_transit', false) AS preorder_pending, s.expected_at AS preorder_eta, s.title AS preorder_shipment
     FROM order_items oi LEFT JOIN shipments s ON s.id = oi.preorder_shipment_id
     WHERE oi.order_id = $1 ORDER BY oi.id`,
    [id],
  );
  return order;
}

export async function addHistory(orderId: number, action: string, note = '', author = 'system'): Promise<void> {
  await query('INSERT INTO order_history(order_id, action, note, author) VALUES ($1, $2, $3, $4)', [
    orderId,
    action,
    note,
    author,
  ]);
}

/** Public projection of an order — never exposes internal fields. */
export function publicOrder(o: OrderRow) {
  return {
    number: o.number,
    status: o.status,
    payment_status: o.payment_status,
    customer_name: o.customer_name,
    customer_phone: o.customer_phone,
    customer_email: o.customer_email,
    delivery_name: o.delivery_name,
    delivery_type: o.delivery_type,
    delivery_city: o.delivery_city,
    delivery_branch: o.delivery_branch,
    delivery_address: o.delivery_address,
    delivery_cost: o.delivery_cost,
    payment_method: o.payment_method,
    payment_name: o.payment_name,
    payment_url: o.payment_url,
    subtotal: o.subtotal,
    discount: o.discount,
    total: o.total,
    promo_code: o.promo_code,
    tracking_number: o.tracking_number,
    comment: o.comment,
    created_at: o.created_at,
    telegram_linked: Boolean(o.telegram_chat_id),
    viber_linked: Boolean(o.viber_user_id),
    items: o.items.map((i) => ({
      name: i.name,
      size: i.size,
      color: i.color,
      image_url: i.image_url,
      price: i.price,
      quantity: i.quantity,
      product_id: i.product_id,
      preorder: i.preorder_pending,
      preorder_eta: i.preorder_pending ? i.preorder_eta : null,
    })),
  };
}

/** SQL condition: the order line waits for an open shipment, so it holds no stock. */
export const PENDING_PREORDER_SQL = `EXISTS (SELECT 1 FROM shipments s WHERE s.id = oi.preorder_shipment_id AND s.status = 'in_transit')`;

/** «очікується ~14 листопада» (server-side copy of the storefront wording). */
export function preorderWhenText(eta: string | null): string {
  if (!eta) return 'очікується найближчим часом';
  const d = new Date(`${eta}T12:00:00`);
  return `очікується ~${d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}`;
}
