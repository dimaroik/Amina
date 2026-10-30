import type { DeliveryType, OrderStatus, PaymentCode, PaymentStatus } from './models';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'Нове',
  confirmed: 'Підтверджене',
  processing: 'Комплектується',
  shipped: 'Відправлене',
  delivered: 'Доставлене',
  completed: 'Виконане',
  cancelled: 'Скасоване',
  returned: 'Повернення',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'Не оплачено',
  awaiting: 'Очікує оплати',
  paid: 'Оплачено',
  refunded: 'Повернено',
  failed: 'Помилка оплати',
};

export const DELIVERY_TYPE_LABELS: Record<DeliveryType, string> = {
  np_warehouse: 'Нова пошта: відділення / поштомат',
  np_courier: 'Нова пошта: кур’єр',
  address: 'Доставка за адресою',
  pickup: 'Самовивіз',
};

export const PAYMENT_CODE_LABELS: Record<PaymentCode, string> = {
  cod: 'Накладений платіж',
  mono_jar: 'Monobank банка / QR',
  iban: 'Переказ на IBAN',
  mono_acquiring: 'Monobank еквайринг (картка)',
};

export const ORDER_STATUSES = Object.keys(ORDER_STATUS_LABELS) as OrderStatus[];
export const PAYMENT_STATUSES = Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatus[];

/** Customer-facing progress steps (cancelled/returned are shown separately). */
export const ORDER_PROGRESS: OrderStatus[] = ['new', 'confirmed', 'processing', 'shipped', 'delivered'];

/** «очікується ~14 листопада» for a pre-ordered item. */
export function preorderWhen(eta: string | null | undefined, short = false): string {
  if (!eta) return short ? 'скоро' : 'очікується найближчим часом';
  const d = new Date(`${eta}T12:00:00`).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
  return short ? `~${d}` : `очікується ~${d}`;
}
