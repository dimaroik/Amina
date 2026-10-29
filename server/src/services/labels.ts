export const ORDER_STATUSES = ['new', 'confirmed', 'processing', 'shipped', 'delivered', 'completed', 'cancelled', 'returned'] as const;
export const PAYMENT_STATUSES = ['pending', 'awaiting', 'paid', 'refunded', 'failed'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const orderStatusLabel: Record<OrderStatus, string> = {
  new: 'Нове',
  confirmed: 'Підтверджене',
  processing: 'Комплектується',
  shipped: 'Відправлене',
  delivered: 'Доставлене',
  completed: 'Виконане',
  cancelled: 'Скасоване',
  returned: 'Повернення',
};

export const paymentStatusLabel: Record<PaymentStatus, string> = {
  pending: 'Не оплачено',
  awaiting: 'Очікує підтвердження',
  paid: 'Оплачено',
  refunded: 'Повернено',
  failed: 'Помилка оплати',
};

/** Customer-facing message for each status change. */
export const statusMessage: Partial<Record<OrderStatus, string>> = {
  confirmed: 'Ваше замовлення підтверджено. Ми вже готуємо його до відправлення.',
  processing: 'Ми комплектуємо ваше замовлення.',
  shipped: 'Ваше замовлення відправлено!',
  delivered: 'Ваше замовлення прибуло. Чекаємо, що вам усе сподобається!',
  completed: 'Дякуємо за покупку в Amina! Будемо раді бачити вас знову.',
  cancelled: 'Ваше замовлення скасовано. Якщо це помилка — напишіть нам.',
  returned: 'Ми оформили повернення за вашим замовленням.',
};

export function money(n: number): string {
  return `${new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(n)} ₴`;
}
