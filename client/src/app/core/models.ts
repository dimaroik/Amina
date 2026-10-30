export interface Category {
  id: number;
  parent_id: number | null;
  name: string;
  slug: string;
  description: string;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
  show_in_menu: boolean;
  product_count?: number;
  children: Category[];
}

export interface CategoryDetail extends Omit<Category, 'children'> {
  breadcrumbs: { name: string; slug: string }[];
  children: { id: number; name: string; slug: string; image_url: string | null }[];
}

export interface ColorOption {
  name: string;
  hex: string | null;
}

export interface ProductCard {
  id: number;
  name: string;
  slug: string;
  price: number;
  old_price: number | null;
  is_new: boolean;
  is_featured: boolean;
  category_slug: string | null;
  category_name: string | null;
  images: string[];
  colors: ColorOption[];
  sizes: string[];
  in_stock: boolean;
}

export interface ProductVariant {
  id: number;
  size: string;
  color: string;
  color_hex: string | null;
  sku: string;
  stock: number;
  price: number | null;
}

export interface ProductImage {
  id?: number;
  url: string;
  alt: string;
  color: string | null;
}

export interface ProductDetail {
  id: number;
  name: string;
  slug: string;
  sku: string;
  description: string;
  composition: string;
  care: string;
  price: number;
  old_price: number | null;
  is_new: boolean;
  is_featured: boolean;
  tags: string[];
  category_id: number | null;
  category_slug: string | null;
  category_name: string | null;
  images: ProductImage[];
  variants: ProductVariant[];
  breadcrumbs: { name: string; slug: string }[];
  related: ProductCard[];
}

export interface ProductListResponse {
  items: ProductCard[];
  total: number;
  page: number;
  pages: number;
  facets: { sizes: string[]; colors: ColorOption[]; price: { min: number; max: number } };
}

export interface ProductQuery {
  category?: string;
  q?: string;
  sizes?: string;
  colors?: string;
  minPrice?: number;
  maxPrice?: number;
  sale?: string;
  new?: string;
  featured?: string;
  inStock?: string;
  ids?: string;
  sort?: 'new' | 'price_asc' | 'price_desc' | 'popular' | 'name';
  page?: number;
  limit?: number;
}

export interface Banner {
  id: number;
  title: string;
  subtitle: string;
  image_url: string;
  link: string;
  button_text: string;
  sort_order: number;
  is_active: boolean;
}

export interface FaqItem {
  id: number;
  question: string;
  answer: string;
  sort_order?: number;
  is_active?: boolean;
}

export interface StoreInfo {
  name: string;
  tagline: string;
  phone: string;
  email: string;
  address: string;
  workHours: string;
  instagram: string;
  telegram: string;
  viber: string;
  whatsapp: string;
  facebook: string;
  tiktok: string;
  about: string;
  announcement: string;
  currency: string;
}

export interface PublicSettings {
  store: StoreInfo;
  chatbot: { enabled: boolean; botName: string; greeting: string };
  analytics: { ga4Id: string; metaPixelId: string };
  telegramBot: string;
}

export interface CartItem {
  variantId: number;
  productId: number;
  slug: string;
  name: string;
  image: string | null;
  size: string;
  color: string;
  price: number;
  oldPrice: number | null;
  quantity: number;
  stock: number;
}

export type DeliveryType = 'np_warehouse' | 'np_courier' | 'address' | 'pickup';
export type PaymentCode = 'cod' | 'mono_jar' | 'iban' | 'mono_acquiring';

export interface DeliveryMethod {
  id: number;
  name: string;
  description: string;
  type: DeliveryType;
  price: number;
  free_from: number | null;
  is_active?: boolean;
  sort_order?: number;
}

export interface PaymentMethod {
  id: number;
  code: PaymentCode;
  name: string;
  description: string;
  is_active?: boolean;
  sort_order?: number;
}

export interface CheckoutConfig {
  delivery: DeliveryMethod[];
  payments: PaymentMethod[];
  novaPoshta: boolean;
}

export type OrderStatus = 'new' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'completed' | 'cancelled' | 'returned';
export type PaymentStatus = 'pending' | 'awaiting' | 'paid' | 'refunded' | 'failed';

export interface PublicOrder {
  number: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  delivery_name: string;
  delivery_type: DeliveryType;
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
  tracking_number: string;
  comment: string;
  created_at: string;
  telegram_linked: boolean;
  viber_linked: boolean;
  access_token?: string;
  items: { name: string; size: string; color: string; image_url: string | null; price: number; quantity: number; product_id: number | null }[];
}

export interface OrderResponse {
  order: PublicOrder;
  accessToken: string;
  payment: {
    method: PaymentCode;
    jarUrl: string;
    iban: { iban: string; recipient: string; edrpou: string; bank: string; purpose: string } | null;
    payUrl: string;
  };
  links: { telegram: string; viber: string };
}

export interface CreateOrderRequest {
  customer: { name: string; phone: string; email: string; contactChannel: 'phone' | 'telegram' | 'viber' | 'whatsapp' | 'email' };
  deliveryMethodId: number;
  delivery: { city: string; cityRef: string; branch: string; branchRef?: string; address: string };
  paymentMethod: PaymentCode;
  promoCode?: string;
  comment: string;
  items: { variantId: number; quantity: number }[];
}

export interface User {
  id: number;
  email: string;
  role: 'customer' | 'admin';
  name: string;
  phone: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  products?: { id: number; name: string; slug: string; price: number; old_price: number | null; images: string[] }[];
  at: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}
