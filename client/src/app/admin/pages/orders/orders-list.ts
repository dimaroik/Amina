import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { errorMessage } from '../../../core/api.service';
import { ORDER_STATUSES, ORDER_STATUS_LABELS, PAYMENT_STATUSES, PAYMENT_STATUS_LABELS } from '../../../core/labels';
import type { OrderStatus, Paged } from '../../../core/models';
import { Toasts } from '../../../core/toast.service';
import { Icon } from '../../../shared/icon';
import { EtaPipe } from '../../../shared/eta.pipe';
import { UahPipe } from '../../../shared/uah.pipe';
import { AdminApi, type AdminOrderRow } from '../../admin-api';
import { Pager } from '../../ui/pager';

interface Filters {
  status: string;
  payment_status: string;
  q: string;
  from: string;
  to: string;
  preorder: string;
  page: number;
}

@Component({
  selector: 'app-admin-orders',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon, UahPipe, EtaPipe, DatePipe, Pager],
  template: `
    <div class="adm-page">
      <div class="adm-page-head">
        <div>
          <h1>Замовлення</h1>
          <div class="sub">Усі замовлення магазину. Натисніть на рядок, щоб відкрити деталі.</div>
        </div>
        <div class="actions">
          <button class="btn btn-ghost btn-sm" (click)="syncNp()" [disabled]="syncing()" title="Оновити статуси посилок з Нової пошти">
            <app-icon name="refresh" [size]="15" /> {{ syncing() ? 'Оновлюємо…' : 'Статуси НП' }}
          </button>
          <button class="btn btn-outline btn-sm" (click)="exportCsv()" [disabled]="exporting()">
            <app-icon name="download" [size]="15" /> CSV
          </button>
        </div>
      </div>

      <div class="adm-tabs">
        <button [class.active]="!f().status" (click)="set({ status: '' })">Усі <span class="count">{{ allCount() }}</span></button>
        @for (s of statuses; track s) {
          <button [class.active]="f().status === s" (click)="set({ status: s })">
            {{ statusLabels[s] }}
            @if (counts()[s]) { <span class="count">{{ counts()[s] }}</span> }
          </button>
        }
      </div>

      <div class="adm-toolbar">
        <div class="search">
          <app-icon name="search" [size]="16" />
          <input class="input" placeholder="Номер, ім’я, телефон, email, ТТН" [ngModel]="f().q" (ngModelChange)="search($event)" />
        </div>
        <select class="select" [ngModel]="f().payment_status" (ngModelChange)="set({ payment_status: $event })">
          <option value="">Будь-яка оплата</option>
          @for (p of paymentStatuses; track p) { <option [value]="p">{{ paymentLabels[p] }}</option> }
        </select>
        <input class="input" type="date" [ngModel]="f().from" (ngModelChange)="set({ from: $event })" title="Від" />
        <input class="input" type="date" [ngModel]="f().to" (ngModelChange)="set({ to: $event })" title="До" />
        <button class="btn btn-sm" [class.btn-ghost]="!f().preorder" (click)="set({ preorder: f().preorder ? '' : '1' })" title="Замовлення, що чекають на поставку">
          <app-icon name="parcel" [size]="15" /> Передзамовлення
        </button>
        <label class="adm-switch" title="Надсилати клієнту сповіщення при швидкій зміні статусу">
          <input type="checkbox" [(ngModel)]="notify" /><span class="track"></span> Сповіщати
        </label>
      </div>

      <div class="adm-card">
        @if (loading() && !data()) {
          <div class="adm-empty"><span class="spinner"></span></div>
        } @else if (data()?.items?.length) {
          <div class="adm-table-wrap">
            <table class="adm-table">
              <thead>
                <tr>
                  <th>Замовлення</th><th>Клієнт</th><th>Доставка</th><th>Оплата</th><th>Статус</th><th class="num">Сума</th>
                </tr>
              </thead>
              <tbody>
                @for (o of data()!.items; track o.id) {
                  <tr class="clickable" (click)="open(o)">
                    <td class="primary">
                      <div class="adm-cell-main">
                        @if (o.preview) { <img [src]="o.preview" class="adm-thumb-sm" alt="" /> }
                        <div>
                          <div class="t">{{ o.number }}</div>
                          <div class="s">{{ o.created_at | date: 'd MMM, HH:mm' }} · {{ o.items_count }} шт</div>
                          @if (o.preorder) { <span class="adm-pill warn pre">Передзамовлення · {{ o.preorder_eta | eta: true }}</span> }
                        </div>
                      </div>
                    </td>
                    <td data-label="Клієнт">
                      <div>{{ o.customer_name }}</div>
                      <div class="adm-muted tiny">{{ o.customer_phone }}</div>
                    </td>
                    <td data-label="Доставка">
                      <div class="clamp">{{ o.delivery_city || '—' }}</div>
                      @if (o.tracking_number) { <div class="adm-muted tiny">ТТН {{ o.tracking_number }}</div> }
                    </td>
                    <td data-label="Оплата">
                      <span class="badge" [class]="'badge badge-' + o.payment_status">{{ paymentLabels[o.payment_status] }}</span>
                    </td>
                    <td data-label="Статус" (click)="$event.stopPropagation()">
                      <select class="status-select" [class]="'status-select badge-' + o.status" [ngModel]="o.status" (ngModelChange)="changeStatus(o, $event)">
                        @for (s of statuses; track s) { <option [value]="s">{{ statusLabels[s] }}</option> }
                      </select>
                    </td>
                    <td class="num" data-label="Сума"><b>{{ o.total | uah }}</b></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <adm-pager [page]="data()!.page" [pages]="data()!.pages" [total]="data()!.total" (go)="set({ page: $event }, false)" />
        } @else {
          <div class="adm-empty">
            <app-icon name="box" [size]="36" />
            <div class="t">Замовлень не знайдено</div>
            <div>Спробуйте змінити фільтри</div>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .pre { display: inline-block; margin-top: 4px; }
    .clamp { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .status-select { appearance: none; border: 0; border-radius: 999px; padding: 4px 24px 4px 10px; font-size: 11.5px; font-weight: 600; cursor: pointer;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23666' stroke-width='1.3'/%3E%3C/svg%3E");
      background-repeat: no-repeat; background-position: right 8px center; }
  `,
})
export class OrdersListPage {
  private api = inject(AdminApi);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toasts = inject(Toasts);

  protected statuses = ORDER_STATUSES;
  protected paymentStatuses = PAYMENT_STATUSES;
  protected statusLabels = ORDER_STATUS_LABELS;
  protected paymentLabels = PAYMENT_STATUS_LABELS;
  protected f = signal<Filters>({ status: '', payment_status: '', q: '', from: '', to: '', preorder: '', page: 1 });
  protected data = signal<(Paged<AdminOrderRow> & { statusCounts: Record<string, number> }) | null>(null);
  protected counts = signal<Record<string, number>>({});
  protected allCount = signal(0);
  protected loading = signal(false);
  protected exporting = signal(false);
  protected notify = true;
  private searchTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.route.queryParamMap.subscribe((p) => {
      this.f.set({
        status: p.get('status') ?? '',
        payment_status: p.get('payment_status') ?? '',
        q: p.get('q') ?? '',
        from: p.get('from') ?? '',
        to: p.get('to') ?? '',
        preorder: p.get('preorder') ?? '',
        page: Number(p.get('page') ?? 1),
      });
      this.load();
    });
  }

  set(patch: Partial<Filters>, resetPage = true) {
    const next = { ...this.f(), ...patch, ...(resetPage ? { page: 1 } : {}) };
    const qp: Record<string, string | number | null> = {};
    for (const [k, v] of Object.entries(next)) qp[k] = v && !(k === 'page' && v === 1) ? v : null;
    this.router.navigate([], { queryParams: qp });
  }

  search(q: string) {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.set({ q }), 300);
  }

  load() {
    this.loading.set(true);
    const f = this.f();
    this.api.get<Paged<AdminOrderRow> & { statusCounts: Record<string, number> }>('/orders', { ...f, limit: 25 }).subscribe({
      next: (r) => {
        this.data.set(r);
        this.counts.set(r.statusCounts);
        this.allCount.set(Object.values(r.statusCounts).reduce((a, b) => a + b, 0));
        this.api.newOrders.set(r.statusCounts['new'] ?? 0);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.toasts.error(errorMessage(e));
      },
    });
  }

  open(o: AdminOrderRow) {
    this.router.navigate(['/admin/orders', o.id]);
  }

  changeStatus(o: AdminOrderRow, status: OrderStatus) {
    this.api.patch(`/orders/${o.id}`, { status, notify: this.notify }).subscribe({
      next: () => {
        this.toasts.success(`${o.number}: ${ORDER_STATUS_LABELS[status]}${this.notify ? ' · клієнта сповіщено' : ''}`);
        this.load();
      },
      error: (e) => {
        this.toasts.error(errorMessage(e));
        this.load();
      },
    });
  }

  protected syncing = signal(false);

  syncNp() {
    this.syncing.set(true);
    this.api.post<{ checked: number; updated: number }>('/np/sync').subscribe({
      next: (r) => {
        this.syncing.set(false);
        this.toasts.success(r.checked ? `Перевірено посилок: ${r.checked}, оновлено: ${r.updated}` : 'Немає посилок для відстеження');
        if (r.updated) this.load();
      },
      error: (e) => {
        this.syncing.set(false);
        this.toasts.error(errorMessage(e));
      },
    });
  }

  async exportCsv() {
    this.exporting.set(true);
    const { page: _page, ...f } = this.f();
    try {
      await this.api.download('/orders/export.csv', f, `orders-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      this.toasts.error(errorMessage(e, 'Не вдалося експортувати'));
    }
    this.exporting.set(false);
  }
}
