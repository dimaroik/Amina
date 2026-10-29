import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../../core/api.service';
import { Auth } from '../../../core/auth.service';
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '../../../core/labels';
import type { PublicOrder, User } from '../../../core/models';
import { Toasts } from '../../../core/toast.service';
import { Icon } from '../../../shared/icon';
import { UahPipe } from '../../../shared/uah.pipe';

@Component({
  selector: 'app-account',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, DatePipe, Icon, UahPipe],
  template: `
    <section class="container page">
      <div class="head">
        <div>
          <span class="eyebrow">Особистий кабінет</span>
          <h1 class="h1">Вітаємо, {{ firstName() }}</h1>
        </div>
        <button class="btn btn-outline btn-sm" (click)="auth.logout()">Вийти</button>
      </div>
      <div class="tabs">
        <button class="chip" [class.active]="tab() === 'orders'" (click)="tab.set('orders')">Мої замовлення</button>
        <button class="chip" [class.active]="tab() === 'profile'" (click)="tab.set('profile')">Профіль</button>
        <a class="chip" routerLink="/wishlist">Обране</a>
      </div>

      @if (tab() === 'orders') {
        @if (orders() === null) {
          <div class="loading"><span class="spinner"></span></div>
        } @else {
          @for (o of orders(); track o.number) {
            <a class="order" [routerLink]="['/order', o.number]" [queryParams]="{ token: o.access_token }">
              <div class="thumbs">
                @for (i of o.items.slice(0, 3); track $index) {
                  <div class="thumb">@if (i.image_url) { <img [src]="i.image_url" [alt]="i.name" /> }</div>
                }
              </div>
              <div class="meta">
                <div class="row1"><b>{{ o.number }}</b><span class="muted small">{{ o.created_at | date: 'd MMMM yyyy' }}</span></div>
                <div class="small muted">{{ o.items.length }} {{ o.items.length === 1 ? 'товар' : 'товари' }} · {{ o.delivery_name }}</div>
                <div class="badges">
                  <span class="badge" [class]="'badge badge-' + o.status">{{ statusLabels[o.status] }}</span>
                  <span class="badge" [class]="'badge badge-' + o.payment_status">{{ paymentLabels[o.payment_status] }}</span>
                </div>
              </div>
              <div class="total">{{ o.total | uah }}<app-icon name="chevron-right" [size]="18" /></div>
            </a>
          } @empty {
            <div class="empty-state">
              <p class="h3">Замовлень поки немає</p>
              <p>Час обрати щось особливе</p>
              <a class="btn" routerLink="/catalog">До каталогу</a>
            </div>
          }
        }
      } @else {
        <form class="profile" (ngSubmit)="save()">
          <div class="form-grid">
            <div class="field full"><label class="label">Email</label><input class="input" [value]="auth.user()?.email" disabled /></div>
            <div class="field"><label class="label">Ім'я та прізвище</label><input class="input" name="name" [(ngModel)]="profile.name" required /></div>
            <div class="field"><label class="label">Телефон</label><input class="input" name="phone" type="tel" [(ngModel)]="profile.phone" /></div>
            <div class="field full"><label class="label">Новий пароль</label><input class="input" name="password" type="password" [(ngModel)]="profile.password" placeholder="Залиште порожнім, щоб не змінювати" autocomplete="new-password" /></div>
          </div>
          <button class="btn" [disabled]="busy()">Зберегти</button>
        </form>
      }
    </section>
  `,
  styles: `
    .page { padding-top: 48px; padding-bottom: 80px; max-width: 920px; }
    .head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 28px; }
    .head .eyebrow { display: block; margin-bottom: 8px; }
    .tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 28px; }
    .loading { display: grid; place-items: center; min-height: 200px; }
    .order { display: flex; align-items: center; gap: 16px; padding: 18px 0; border-bottom: 1px solid var(--line); transition: background .2s; }
    .order:hover { background: var(--surface-2); }
    .thumbs { display: flex; flex-shrink: 0; }
    .thumb { width: 52px; aspect-ratio: 3/4; background: var(--surface-2); border: 2px solid var(--bg); margin-left: -14px; overflow: hidden; }
    .thumb:first-child { margin-left: 0; }
    .thumb img { width: 100%; height: 100%; object-fit: cover; }
    .meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .row1 { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
    .badges { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
    .total { display: flex; align-items: center; gap: 6px; font-weight: 500; white-space: nowrap; }
    .profile { display: flex; flex-direction: column; gap: 20px; max-width: 560px; align-items: flex-start; }
    .profile .form-grid { width: 100%; }
    @media (max-width: 599px) { .thumbs .thumb:nth-child(n+2) { display: none; } }
  `,
})
export class AccountPage {
  protected auth = inject(Auth);
  private api = inject(Api);
  private toasts = inject(Toasts);
  protected statusLabels = ORDER_STATUS_LABELS;
  protected paymentLabels = PAYMENT_STATUS_LABELS;
  protected tab = signal<'orders' | 'profile'>('orders');
  protected orders = signal<PublicOrder[] | null>(null);
  protected busy = signal(false);
  protected profile = { name: this.auth.user()?.name ?? '', phone: this.auth.user()?.phone ?? '', password: '' };
  protected firstName = () => (this.auth.user()?.name ?? '').split(' ')[0];

  constructor() {
    this.api.get<PublicOrder[]>('/account/orders').subscribe({ next: (r) => this.orders.set(r), error: () => this.orders.set([]) });
    this.api.get<User>('/auth/me').subscribe((u) => {
      this.auth.updateUser(u);
      this.profile.name = u.name;
      this.profile.phone = u.phone;
    });
  }

  save() {
    this.busy.set(true);
    const body = { name: this.profile.name, phone: this.profile.phone, password: this.profile.password || undefined };
    this.api.put<User>('/account/profile', body).subscribe({
      next: (u) => {
        this.busy.set(false);
        this.auth.updateUser(u);
        this.profile.password = '';
        this.toasts.success('Профіль оновлено');
      },
      error: (e) => {
        this.busy.set(false);
        this.toasts.error(errorMessage(e));
      },
    });
  }
}
