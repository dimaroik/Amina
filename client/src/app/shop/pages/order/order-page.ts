import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { Api, errorMessage } from '../../../core/api.service';
import type { OrderResponse } from '../../../core/models';
import { Icon } from '../../../shared/icon';
import { OrderDetails } from './order-details';

@Component({
  selector: 'app-order-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, OrderDetails],
  template: `
    <section class="container page">
      @if (error()) {
        <div class="empty-state">
          <app-icon name="box" [size]="40" />
          <p class="h3">Замовлення не знайдено</p>
          <p>{{ error() }}</p>
          <a class="btn" routerLink="/track">Знайти за номером і телефоном</a>
        </div>
      } @else if (!data()) {
        <div class="loading"><span class="spinner"></span></div>
      } @else {
        <div class="hero">
          @if (fresh()) {
            <div class="check"><app-icon name="check" [size]="30" [stroke]="1.8" /></div>
            <span class="eyebrow">Замовлення прийнято</span>
            <h1 class="h1">Дякуємо, {{ firstName() }}!</h1>
            <p class="muted">Ваше замовлення <b class="ink">{{ data()!.order.number }}</b> оформлено. Ми зв’яжемося з вами для підтвердження@if (data()!.order.customer_email) {, а деталі вже летять на {{ data()!.order.customer_email }}}.</p>
          } @else {
            <span class="eyebrow">Статус замовлення</span>
            <h1 class="h1">Замовлення {{ data()!.order.number }}</h1>
          }
        </div>
        <app-order-details [data]="data()!" (refresh)="load(true)" />
        <div class="actions">
          <a class="btn btn-outline" routerLink="/catalog">Продовжити покупки</a>
        </div>
      }
    </section>
  `,
  styles: `
    .page { padding-top: 48px; padding-bottom: 96px; max-width: 980px; }
    .loading { display: grid; place-items: center; min-height: 40vh; }
    .hero { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px; margin-bottom: 40px; p { max-width: 560px; margin: 0; } }
    .ink { color: var(--ink); }
    .check { width: 64px; height: 64px; border-radius: 50%; background: var(--ink); color: var(--bg); display: grid; place-items: center; animation: pop .6s var(--ease); margin-bottom: 8px; }
    @keyframes pop { 0% { transform: scale(.4); opacity: 0; } 70% { transform: scale(1.08); } }
    .empty-state app-icon { margin: 0 auto 16px; }
    .actions { display: flex; justify-content: center; margin-top: 40px; }
  `,
})
export class OrderPage {
  readonly number = input.required<string>();
  readonly token = input<string>();
  readonly phone = input<string>();

  private api = inject(Api);
  protected data = signal<OrderResponse | null>(null);
  protected error = signal('');
  protected fresh = signal(false);
  protected firstName = computed(() => this.data()?.order.customer_name.split(' ')[0] ?? '');
  private sub?: Subscription;

  constructor() {
    const destroy = inject(DestroyRef);
    destroy.onDestroy(() => this.sub?.unsubscribe());
    effect(() => {
      const number = this.number();
      try {
        const cached = JSON.parse(sessionStorage.getItem('amina.lastOrder') ?? 'null') as OrderResponse | null;
        if (cached?.order.number === number) {
          this.data.set(cached);
          this.fresh.set(true);
        }
      } catch { /* ignore */ }
      this.load();
    });
    // poll while an online payment is pending so the page flips to "paid" by itself
    const timer = setInterval(() => {
      const d = this.data();
      if (d && d.order.payment_status === 'awaiting' && d.order.payment_method === 'mono_acquiring' && !document.hidden) this.load(true);
    }, 15000);
    destroy.onDestroy(() => clearInterval(timer));
  }

  load(silent = false) {
    const token = this.token() || this.data()?.accessToken;
    this.sub?.unsubscribe();
    this.sub = this.api.get<OrderResponse>(`/orders/${encodeURIComponent(this.number())}`, { token, phone: token ? undefined : this.phone() }).subscribe({
      next: (r) => {
        this.data.set(r);
        this.error.set('');
      },
      error: (e) => {
        if (!silent && !this.data()) this.error.set(errorMessage(e));
      },
    });
  }
}
