import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ORDER_PROGRESS, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '../../../core/labels';
import type { OrderResponse } from '../../../core/models';
import { Toasts } from '../../../core/toast.service';
import { Icon } from '../../../shared/icon';
import { EtaPipe } from '../../../shared/eta.pipe';
import { UahPipe } from '../../../shared/uah.pipe';

/** Full order view: progress, payment instructions (incl. Monobank QR), items and delivery. */
@Component({
  selector: 'app-order-details',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe, Icon, UahPipe, EtaPipe],
  templateUrl: './order-details.html',
  styleUrl: './order-details.scss',
})
export class OrderDetails {
  readonly data = input.required<OrderResponse>();
  readonly refresh = output<void>();
  private toasts = inject(Toasts);

  protected statusLabels = ORDER_STATUS_LABELS;
  protected paymentLabels = PAYMENT_STATUS_LABELS;
  protected steps = ORDER_PROGRESS;
  protected qr = signal('');

  protected o = computed(() => this.data().order);
  protected stopped = computed(() => ['cancelled', 'returned'].includes(this.o().status));
  protected stepIndex = computed(() => {
    const s = this.o().status;
    if (s === 'completed') return this.steps.length - 1;
    return Math.max(0, this.steps.indexOf(s));
  });
  protected showPayment = computed(
    () => this.o().payment_status !== 'paid' && this.o().payment_status !== 'refunded' && !this.stopped() && this.o().payment_method !== 'cod',
  );
  protected purpose = computed(() => this.data().payment.iban?.purpose ?? `Оплата замовлення ${this.o().number}`);
  protected trackUrl = computed(() => `https://novaposhta.ua/tracking/?cargo_number=${encodeURIComponent(this.o().tracking_number)}`);
  protected deliveryLine = computed(() => {
    const o = this.o();
    return [o.delivery_city, o.delivery_branch, o.delivery_address].filter(Boolean).join(', ');
  });

  constructor() {
    effect(() => {
      const url = this.data().payment.jarUrl;
      if (!url || !this.showPayment()) return;
      import('qrcode')
        .then((m) => (m.default ?? m).toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#1f1d1a', light: '#00000000' } }))
        .then((svg) => this.qr.set(svg))
        .catch(() => this.qr.set(''));
    });
  }

  copy(text: string, what = 'Скопійовано') {
    navigator.clipboard?.writeText(text).then(
      () => this.toasts.success(what),
      () => this.toasts.error('Не вдалося скопіювати'),
    );
  }

  qrDataUrl() {
    return `data:image/svg+xml;utf8,${encodeURIComponent(this.qr())}`;
  }
}
