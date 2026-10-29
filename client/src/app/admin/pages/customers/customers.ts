import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Icon } from '../../../shared/icon';
import { UahPipe } from '../../../shared/uah.pipe';
import { AdminApi, phoneDigits, type Customer } from '../../admin-api';

@Component({
  selector: 'app-admin-customers',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, RouterLink, Icon, UahPipe],
  template: `
    <div class="adm-page">
      <div class="adm-page-head">
        <div><h1>Клієнти</h1><div class="sub">Усі, хто робив замовлення, згруповані за номером телефону</div></div>
        <div class="adm-seg">
          <button [class.active]="tab() === 'customers'" (click)="tab.set('customers')">Покупці</button>
          <button [class.active]="tab() === 'subscribers'" (click)="tab.set('subscribers'); loadSubscribers()">Підписники розсилки</button>
        </div>
      </div>

      @if (tab() === 'customers') {
        <div class="adm-toolbar">
          <div class="search"><app-icon name="search" [size]="16" /><input class="input" placeholder="Ім'я, телефон або email" [ngModel]="q()" (ngModelChange)="q.set($event); q$.next($event)" /></div>
        </div>
        <div class="adm-grid adm-grid-3" style="margin-bottom:16px">
          <div class="adm-card adm-kpi"><div class="k">Клієнтів</div><div class="v">{{ items().length }}</div></div>
          <div class="adm-card adm-kpi"><div class="k">Повторні покупці</div><div class="v">{{ repeat() }}</div></div>
          <div class="adm-card adm-kpi"><div class="k">Сума покупок</div><div class="v">{{ totalSpent() | uah }}</div></div>
        </div>
        <div class="adm-card">
          @if (items().length) {
            <div class="adm-table-wrap">
              <table class="adm-table">
                <thead><tr><th>Клієнт</th><th>Контакти</th><th class="num">Замовлень</th><th class="num">Сума</th><th>Останнє</th><th></th></tr></thead>
                <tbody>
                  @for (c of items(); track c.key) {
                    <tr>
                      <td class="primary"><b>{{ c.name }}</b> @if (c.registered) { <span class="adm-pill">акаунт</span> } @if (c.orders > 1) { <span class="adm-pill ok">постійний</span> }</td>
                      <td data-label="Контакти"><a class="link-plain" [href]="'tel:+' + digits(c.phone)">{{ c.phone }}</a>@if (c.email) { <div class="adm-muted small">{{ c.email }}</div> }</td>
                      <td class="num" data-label="Замовлень">{{ c.orders }}</td>
                      <td class="num" data-label="Сума">{{ c.spent | uah }}</td>
                      <td data-label="Останнє">{{ c.last_order | date: 'dd.MM.yyyy' }}</td>
                      <td class="nowrap">
                        <a class="btn btn-ghost btn-xs" routerLink="/admin/orders" [queryParams]="{ q: c.phone }">Замовлення</a>
                        <a class="icon-btn" [href]="'https://wa.me/' + digits(c.phone)" target="_blank" title="WhatsApp"><app-icon name="whatsapp" [size]="16" /></a>
                        <a class="icon-btn" [href]="'viber://chat?number=%2B' + digits(c.phone)" title="Viber"><app-icon name="viber" [size]="16" /></a>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <div class="adm-empty"><app-icon name="users" [size]="36" /><div class="t">Клієнтів поки немає</div><div>Вони з'являться після перших замовлень</div></div>
          }
        </div>
      } @else {
        <div class="adm-card">
          <div class="adm-card-head"><h3>Підписники ({{ subscribers().length }})</h3>
            @if (subscribers().length) { <button class="btn btn-ghost btn-xs" (click)="copyEmails()"><app-icon name="copy" [size]="14" /> Копіювати всі email</button> }
          </div>
          <ul class="adm-list" style="padding:0 18px">
            @for (s of subscribers(); track s.id) {
              <li><span style="flex:1">{{ s.email }}</span><span class="adm-muted small">{{ s.created_at | date: 'dd.MM.yyyy' }}</span></li>
            } @empty {
              <li class="adm-muted">Ще ніхто не підписався</li>
            }
          </ul>
        </div>
      }
    </div>
  `,
})
export class CustomersPage {
  private api = inject(AdminApi);
  protected tab = signal<'customers' | 'subscribers'>('customers');
  protected q = signal('');
  protected q$ = new Subject<string>();
  protected items = signal<Customer[]>([]);
  protected subscribers = signal<{ id: number; email: string; created_at: string }[]>([]);
  protected repeat = computed(() => this.items().filter((c) => c.orders > 1).length);
  protected totalSpent = computed(() => this.items().reduce((s, c) => s + Number(c.spent), 0));
  protected digits = phoneDigits;

  constructor() {
    this.load('');
    this.q$.pipe(debounceTime(300), takeUntilDestroyed()).subscribe((q) => this.load(q));
  }

  load(q: string) {
    this.api.get<Customer[]>('/customers', { q }).subscribe((r) => this.items.set(r));
  }

  loadSubscribers() {
    this.api.get<{ id: number; email: string; created_at: string }[]>('/subscribers').subscribe((r) => this.subscribers.set(r));
  }

  copyEmails() {
    navigator.clipboard?.writeText(this.subscribers().map((s) => s.email).join(', '));
  }
}
