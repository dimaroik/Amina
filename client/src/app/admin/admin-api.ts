import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { Api } from '../core/api.service';
import type { Category, DeliveryMethod, OrderStatus, PaymentCode, PaymentMethod, PaymentStatus } from '../core/models';

export interface AdminOrderRow {
  id: number;
  number: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  delivery_name: string;
  delivery_city: string;
  payment_name: string;
  total: number;
  created_at: string;
  tracking_number: string;
  admin_note: string;
  items_count: number;
  preview: string | null;
  preorder?: boolean;
  preorder_eta?: string | null;
}

export interface AdminOrderItem {
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
  preorder_shipment_id?: number | null;
  preorder_pending?: boolean;
  preorder_eta?: string | null;
  preorder_shipment?: string | null;
}

export interface AdminOrder {
  id: number;
  number: string;
  access_token: string;
  user_id: number | null;
  status: OrderStatus;
  payment_status: PaymentStatus;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  contact_channel: string;
  delivery_name: string;
  delivery_type: string;
  delivery_city: string;
  delivery_branch: string;
  delivery_address: string;
  delivery_cost: number;
  payment_method: PaymentCode;
  payment_name: string;
  payment_url: string | null;
  subtotal: number;
  discount: number;
  total: number;
  promo_code: string | null;
  comment: string;
  admin_note: string;
  tracking_number: string;
  telegram_chat_id: string | null;
  viber_user_id: string | null;
  delivery_city_ref: string;
  delivery_branch_ref: string;
  np_ttn_ref: string | null;
  np_status: string;
  np_status_code: string;
  np_status_at: string | null;
  created_at: string;
  updated_at: string;
  items: AdminOrderItem[];
  history?: { id: number; action: string; note: string; author: string; created_at: string }[];
  notifications?: { id: number; channel: string; recipient: string; subject: string; status: string; error: string | null; created_at: string }[];
  customerStats?: { count: number; spent: number };
}

export interface AdminProductRow {
  id: number;
  name: string;
  slug: string;
  sku: string;
  price: number;
  old_price: number | null;
  is_active: boolean;
  is_featured: boolean;
  is_new: boolean;
  sales_count: number;
  created_at: string;
  category_name: string | null;
  image: string | null;
  stock: number;
  variants_count: number;
  waiting: number;
}

export interface AdminVariant {
  id?: number;
  /** Landed cost per unit, ₴ (filled in by received shipments, editable). */
  cost_price?: number | null;
  /** People waiting for a back-in-stock alert (read-only). */
  waiting?: number;
  size: string;
  color: string;
  color_hex: string | null;
  sku: string;
  stock: number;
  price: number | null;
}

export interface AdminProduct {
  id?: number;
  name: string;
  slug: string;
  category_id: number | null;
  sku: string;
  description: string;
  composition: string;
  care: string;
  price: number;
  old_price: number | null;
  is_active: boolean;
  is_featured: boolean;
  is_new: boolean;
  tags: string[];
  images: { url: string; alt: string; color: string | null }[];
  variants: AdminVariant[];
}

export interface VariantSearchRow {
  id: number;
  size: string;
  color: string;
  stock: number;
  price: number;
  name: string;
  product_id: number;
  image: string | null;
}

export interface Dashboard {
  days: number;
  totals: { orders: number; revenue: number; avg_check: number; customers: number };
  prev: { orders: number; revenue: number };
  daily: { date: string; orders: number; revenue: number }[];
  byStatus: { status: OrderStatus; count: number }[];
  top: { name: string; product_id: number | null; qty: number; revenue: number; image: string | null }[];
  recent: { id: number; number: string; customer_name: string; total: number; status: OrderStatus; payment_status: PaymentStatus; created_at: string }[];
  lowStock: { id: number; name: string; size: string; color: string; stock: number }[];
  chats: { waiting: number; today: number };
  profit?: { gross: number; covered_revenue: number; items_revenue: number };
}

export interface Customer {
  key: string;
  name: string;
  phone: string;
  email: string | null;
  orders: number;
  spent: number;
  last_order: string;
  registered: boolean;
}

export interface ChatRow {
  id: string;
  needs_human: boolean;
  contact: string;
  created_at: string;
  updated_at: string;
  messages: number;
  first_message: string | null;
}

export interface PromoCode {
  id?: number;
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  min_total: number;
  max_uses: number | null;
  used_count?: number;
  expires_at: string | null;
  is_active: boolean;
}

export interface AdminSettings {
  settings: {
    store: Record<string, string>;
    payment: { monoJarUrl: string; iban: string; recipient: string; edrpou: string; bankName: string; paymentPurpose: string };
    notifications: {
      adminEmails: string[];
      telegramAdminChatIds: string[];
      viberAdminIds: string[];
      notifyCustomerEmail: boolean;
      notifyCustomerWhatsapp: boolean;
      notifyAdminOnChatHandoff: boolean;
    };
    chatbot: { enabled: boolean; botName: string; greeting: string; instructions: string };
    novaPoshta: {
      senderCityRef: string;
      senderCityName: string;
      senderWarehouseRef: string;
      senderWarehouseName: string;
      senderPhone: string;
      defaultWeight: number;
      defaultDescription: string;
      payer: 'Recipient' | 'Sender';
      autoTrack: boolean;
    };
    analytics: { ga4Id: string; metaPixelId: string };
  };
  integrations: {
    email: boolean;
    telegram: boolean;
    telegramBot: string;
    viber: boolean;
    whatsapp: boolean;
    monobankAcquiring: boolean;
    novaPoshta: boolean;
    chatbotAi: boolean;
    publicUrl: string;
  };
}

export type { Category, DeliveryMethod, PaymentMethod };

/** Admin endpoints (/api/admin/*) plus small shared admin state (sidebar badges). */
@Injectable({ providedIn: 'root' })
export class AdminApi {
  private api = inject(Api);
  private http = inject(HttpClient);

  /** Sidebar badges, refreshed by the layout and after order/chat changes. */
  readonly newOrders = signal(0);
  readonly waitingChats = signal(0);
  readonly pendingReviews = signal(0);

  get<T>(path: string, params?: Record<string, string | number | boolean | null | undefined>): Observable<T> {
    return this.api.get<T>(`/admin${path}`, params);
  }
  post<T>(path: string, body?: unknown): Observable<T> {
    return this.api.post<T>(`/admin${path}`, body);
  }
  put<T>(path: string, body?: unknown): Observable<T> {
    return this.api.put<T>(`/admin${path}`, body);
  }
  patch<T>(path: string, body?: unknown): Observable<T> {
    return this.api.patch<T>(`/admin${path}`, body);
  }
  delete<T>(path: string): Observable<T> {
    return this.api.delete<T>(`/admin${path}`);
  }
  upload(files: File[]): Observable<{ id: string; url: string; width: number; height: number }[]> {
    return this.api.upload('/admin/uploads', files);
  }

  refreshBadges() {
    this.get<{ statusCounts: Record<string, number> }>('/orders', { limit: 1 }).subscribe({
      next: (r) => this.newOrders.set(r.statusCounts['new'] ?? 0),
      error: () => {},
    });
    this.get<{ counts: Record<string, number> }>('/reviews', { status: 'pending' }).subscribe({
      next: (r) => this.pendingReviews.set(r.counts['pending'] ?? 0),
      error: () => {},
    });
    this.get<ChatRow[]>('/chats').subscribe({
      next: (r) => this.waitingChats.set(r.filter((c) => c.needs_human).length),
      error: () => {},
    });
  }

  /** Opens an authenticated PDF in a new tab (a plain link would carry no token). */
  async openPdf(path: string, params: Record<string, string | number | undefined> = {}) {
    const win = window.open('', '_blank');
    try {
      const blob = await firstValueFrom(this.http.get(this.api.url(`/admin${path}`, params), { responseType: 'blob' }));
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url;
      else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      win?.close();
      throw err;
    }
  }

  /** Downloads an authenticated file (the interceptor adds the token). */
  async download(path: string, params: Record<string, string | number | undefined>, filename: string) {
    const blob = await firstValueFrom(this.http.get(this.api.url(`/admin${path}`, params), { responseType: 'blob' }));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Flattens a category tree into an indented option list for <select>. */
export function flattenCategories(list: Category[], depth = 0, out: { id: number; name: string; depth: number; label: string }[] = []) {
  for (const c of list) {
    out.push({ id: c.id, name: c.name, depth, label: `${'— '.repeat(depth)}${c.name}` });
    flattenCategories(c.children, depth + 1, out);
  }
  return out;
}

export function phoneDigits(phone: string): string {
  let d = (phone || '').replace(/\D/g, '');
  if (d.startsWith('0') && d.length === 10) d = `38${d}`;
  return d;
}

export interface AdminReview {
  id: number;
  product_id: number;
  product_name: string;
  product_slug: string;
  product_image: string | null;
  name: string;
  rating: number;
  text: string;
  size: string;
  height: number | null;
  fit: 'small' | 'true' | 'large' | null;
  photos: string[];
  verified: boolean;
  status: 'pending' | 'approved' | 'rejected';
  admin_reply: string;
  created_at: string;
}

export type Currency = 'USD' | 'CNY' | 'EUR' | 'UAH';

export interface ShipmentTotals {
  units: number;
  goods: number;
  extra: number;
  total: number;
  total_uah: number;
  avg_unit_uah: number;
  expected_revenue: number;
  expected_profit: number;
  margin: number | null;
}

export interface ShipmentItem {
  id: number;
  product_id: number | null;
  variant_id: number | null;
  name: string;
  size: string;
  color: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  total_cost: number;
  sale_price: number | null;
  margin: number | null;
  image: string | null;
  stock: number | null;
  product_slug: string | null;
  activate_on_receive: boolean;
  preordered?: number;
}

export interface ShipmentPreorder {
  id: number;
  number: string;
  customer_name: string;
  status: OrderStatus;
  created_at: string;
  quantity: number;
}

export interface Shipment {
  id: number;
  title: string;
  supplier: string;
  status: 'in_transit' | 'received';
  currency: Currency;
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
  totals: ShipmentTotals;
  items: ShipmentItem[];
  previews?: string[];
  preorders?: ShipmentPreorder[];
}

// ---------- AI ----------

export interface ProductDraft {
  name: string;
  description: string;
  composition: string;
  care: string;
  category_id: number | null;
  colors: string[];
  sizes: string[];
  tags: string[];
  notes: string;
}

// ---------- restock report ----------

export interface RestockLine {
  variant_id: number;
  size: string;
  color: string;
  color_hex: string | null;
  stock: number;
  incoming: number;
  waiting: number;
  sold: number;
  per_week: number;
  cover_days: number | null;
  suggest: number;
  sold_out: boolean;
}

export interface RestockProduct {
  product_id: number;
  name: string;
  slug: string;
  image: string | null;
  is_active: boolean;
  price: number;
  unit_cost: number | null;
  sold: number;
  revenue: number;
  profit: number | null;
  margin: number | null;
  stock: number;
  incoming: number;
  suggest: number;
  lines: RestockLine[];
}

export interface DeadStock {
  product_id: number;
  name: string;
  slug: string;
  image: string | null;
  is_active: boolean;
  price: number;
  units: number;
  sizes: string[];
  cost_value: number | null;
  cost_partial: boolean;
  retail_value: number;
  last_sale_at: string | null;
  days_idle: number;
}

export interface RestockReport {
  params: { days: number; target: number; dead: number };
  summary: {
    sold: number;
    revenue: number;
    profit: number | null;
    margin: number | null;
    profit_coverage: number;
    sold_out: number;
    reorder_units: number;
    dead_units: number;
    dead_cost: number;
    dead_retail: number;
  };
  reorder: RestockProduct[];
  top: Omit<RestockProduct, 'lines'>[];
  sizes: { name: string; sold: number; stock: number; hex: string | null }[];
  colors: { name: string; sold: number; stock: number; hex: string | null }[];
  dead: DeadStock[];
  shipments: {
    id: number;
    title: string;
    received_at: string;
    units: number;
    cost: number;
    sold: number;
    revenue: number;
    sell_through: number;
    payback: number | null;
  }[];
}
