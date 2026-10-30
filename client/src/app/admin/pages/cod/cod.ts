import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../../core/api.service';
import { Toasts } from '../../../core/toast.service';
import { Icon } from '../../../shared/icon';
import { UahPipe } from '../../../shared/uah.pipe';
import { AdminApi } from '../../admin-api';
import { Confirm } from '../../ui/confirm';

type CodState = 'awaiting' | 'collected' | 'paid_out' | 'refused';

interface CodRow {
  id: number;
  number: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  tracking_number: string;
  np_status: string;
  cod_amount: number;
  cod_status: CodState | 'none';
  cod_paid_at: string | null;
  refused_at: string | null;
  created_at: string;
  total: number;
  phone_refusals: number;
  prepay_only: boolean;
}

interface Refuser {
  phone_key: string;
  phone: string;
  name: string;
  refusals: number;
  orders: number;
  last_refused: string | null;
  prepay_only: boolean;
  note: string;
  manual: boolean;
}

interface CodResponse {
  summary: {
    awaiting_count: number;
    awaiting_sum: number;
    collected_count: number;
    collected_sum: number;
    paid_30_count: number;
    paid_30_sum: number;
    refused_90: number;
    refused_90_sum: number;
    shipped_90: number;
  };
  items: CodRow[];
  refusers: Refuser[];
  blockAfter: number;
}

const LABELS: Record<string, { t: string; cls: string }> = {
  awaiting: { t: 'Посилка в дорозі', cls: '' },
  collected: { t: 'Клієнт оплатив — гроші йдуть', cls: 'warn' },
  paid_out: { t: 'Гроші отримано', cls: 'ok' },
  refused: { t: 'Не забрали', cls: 'danger' },
  none: { t: '—', cls: '' },
};

@Component({
  selector: 'app-admin-cod',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, UahPipe, DatePipe],
  template: `
    <div class="adm-page">
      <div class="adm-page-head">
        <div>
          <h1>Накладений платіж</h1>
          <div class="sub">Скільки грошей у дорозі, що вже прийшло на рахунок і хто не забирає посилки. Статуси оновлюються з Нової пошти.</div>
        </div>
        <div class="actions"><button class="btn btn-ghost btn-sm" (click)="sync()" [disabled]="syncing()"><app-icon name="refresh" [size]="15" /> {{ syncing() ? 'Оновлюємо…' : 'Оновити з НП' }}</button></div>
      </div>

      @if (d(); as d) {
        <div class="adm-grid adm-grid-4">
          <button class="adm-card adm-kpi kpi" [class.on]="state() === 'awaiting'" (click)="pick('awaiting')">
            <div class="k"><app-icon name="truck" [size]="15" /> В дорозі до клієнтів</div>
            <div class="v">{{ d.summary.awaiting_sum | uah }}</div>
            <div class="d flat">{{ d.summary.awaiting_count }} посилок</div>
          </button>
          <button class="adm-card adm-kpi kpi" [class.on]="state() === 'collected'" (click)="pick('collected')">
            <div class="k"><app-icon name="clock" [size]="15" /> Оплачено, гроші йдуть</div>
            <div class="v">{{ d.summary.collected_sum | uah }}</div>
            <div class="d flat">{{ d.summary.collected_count }} — зазвичай 1–2 дні</div>
          </button>
          <button class="adm-card adm-kpi kpi" [class.on]="state() === 'paid_out'" (click)="pick('paid_out')">
            <div class="k"><app-icon name="check" [size]="15" /> Отримано за 30 днів</div>
            <div class="v">{{ d.summary.paid_30_sum | uah }}</div>
            <div class="d flat">{{ d.summary.paid_30_count }} переказів</div>
          </button>
          <button class="adm-card adm-kpi kpi" [class.on]="state() === 'refused'" (click)="pick('refused')">
            <div class="k"><app-icon name="close" [size]="15" /> Невикуп за 90 днів</div>
            <div class="v">{{ d.summary.refused_90 }}@if (refusalRate() !== null) { <span class="rate">{{ refusalRate() }}%</span> }</div>
            <div class="d flat">на {{ d.summary.refused_90_sum | uah }}</div>
          </button>
        </div>

        <section class="adm-card">
          <div class="adm-card-head">
            <h2>{{ title() }}</h2>
            @if (state()) { <button class="btn btn-ghost btn-xs" (click)="pick(null)">Показати всі</button> }
          </div>
          @if (d.items.length) {
            <div class="adm-table-wrap">
              <table class="adm-table">
                <thead><tr><th>Замовлення</th><th>Клієнт</th><th>ТТН / Нова пошта</th><th>Стан</th><th class="num">Сума</th><th></th></tr></thead>
                <tbody>
                  @for (o of d.items; track o.id) {
                    <tr>
                      <td class="primary"><a class="t link-plain" [routerLink]="['/admin/orders', o.id]">{{ o.number }}</a><div class="adm-muted tiny">{{ o.created_at | date: 'dd.MM.yy' }}</div></td>
                      <td data-label="Клієнт">
                        <div>{{ o.customer_name }}</div>
                        <div class="adm-muted tiny">{{ o.customer_phone }}
                          @if (o.prepay_only) { · <span class="flag">лише передоплата</span> }
                          @else if (o.phone_refusals > 1) { · <span class="flag">{{ o.phone_refusals }} невикупи</span> }
                        </div>
                      </td>
                      <td data-label="ТТН"><div>{{ o.tracking_number || '—' }}</div><div class="adm-muted tiny clamp">{{ o.np_status }}</div></td>
                      <td data-label="Стан">
                        <span class="adm-pill" [class]="'adm-pill ' + label(o).cls">{{ label(o).t }}</span>
                        @if (o.cod_paid_at) { <div class="adm-muted tiny">{{ o.cod_paid_at | date: 'dd.MM.yy' }}</div> }
                        @if (o.refused_at) { <div class="adm-muted tiny">{{ o.refused_at | date: 'dd.MM.yy' }}</div> }
                      </td>
                      <td class="num" data-label="Сума"><b>{{ (o.cod_amount || o.total) | uah }}</b></td>
                      <td class="acts">
                        @if (o.cod_status === 'awaiting' || o.cod_status === 'collected') {
                          <button class="btn btn-xs" (click)="paid(o)">Гроші отримано</button>
                          @if (!o.refused_at) { <button class="btn btn-ghost btn-xs" (click)="refused(o)">Не забрали</button> }
                        }
                        @if (o.refused_at && !o.prepay_only) { <button class="btn btn-ghost btn-xs" (click)="flag(o.customer_phone, true)">Лише передоплата</button> }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <div class="adm-empty"><app-icon name="card" [size]="30" /><div class="t">Тут порожньо</div><div>Замовлення з накладеним платежем з'являться після створення ТТН.</div></div>
          }
        </section>

        <section class="adm-card">
          <div class="adm-card-head">
            <h2>Номери з невикупами</h2>
            <span class="adm-hint">@if (d.blockAfter > 0) { Після {{ d.blockAfter }} невикупів накладений платіж вимикається автоматично } @else { Автоблокування вимкнене (Налаштування → Оплата) }</span>
          </div>
          @if (d.refusers.length) {
            <div class="adm-table-wrap">
              <table class="adm-table">
                <thead><tr><th>Клієнт</th><th class="num">Невикупи</th><th class="num">Усього замовлень</th><th>Останній</th><th>Накладений платіж</th></tr></thead>
                <tbody>
                  @for (r of d.refusers; track r.phone_key) {
                    <tr>
                      <td class="primary"><div>{{ r.name }}</div><div class="adm-muted tiny">{{ r.phone }}@if (r.note) { · {{ r.note }} }</div></td>
                      <td class="num" data-label="Невикупи"><b [class.bad]="r.refusals >= (d.blockAfter || 99)">{{ r.refusals }}</b></td>
                      <td class="num" data-label="Замовлень">{{ r.orders }}</td>
                      <td data-label="Останній">{{ r.last_refused ? (r.last_refused | date: 'dd.MM.yy') : '—' }}</td>
                      <td data-label="Накладений">
                        <label class="adm-switch">
                          <input type="checkbox" [checked]="allowed(r)" (change)="flag(r.phone, !$any($event.target).checked)" /><span class="track"></span>
                          {{ allowed(r) ? (r.manual && blocked(r) ? 'Дозволено вручну' : 'Дозволено') : r.manual ? 'Лише передоплата' : 'Вимкнено (ліміт невикупів)' }}
                        </label>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <div class="adm-empty"><div>Поки всі забирають посилки 🤍</div></div>
          }
        </section>
      } @else {
        <div class="adm-empty"><span class="spinner"></span></div>
      }
    </div>
  `,
  styles: `
    .adm-page { display: flex; flex-direction: column; gap: 16px; }
    .adm-page-head { margin-bottom: 0; }
    .kpi { text-align: left; font: inherit; color: inherit; cursor: pointer; transition: border-color .2s, box-shadow .2s; }
    .kpi:hover { border-color: var(--line-strong); }
    .kpi.on { border-color: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); }
    .rate { font-size: 14px; color: var(--muted); margin-left: 8px; font-weight: 500; }
    .flag { color: var(--danger); font-weight: 600; }
    .bad { color: var(--danger); }
    .clamp { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .acts { white-space: nowrap; text-align: right; }
    .acts .btn + .btn { margin-left: 6px; }
  `,
})
export class CodPage {
  private api = inject(AdminApi);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  protected d = signal<CodResponse | null>(null);
  protected state = signal<CodState | null>(null);
  protected syncing = signal(false);

  protected title = computed(() => {
    const s = this.state();
    return s ? { awaiting: 'Посилки в дорозі', collected: 'Клієнт оплатив — чекаємо гроші', paid_out: 'Гроші отримано', refused: 'Не забрали посилку' }[s] : 'Усі посилки з накладеним платежем';
  });
  protected refusalRate = computed(() => {
    const s = this.d()?.summary;
    return s && s.shipped_90 ? Math.round((s.refused_90 / s.shipped_90) * 100) : null;
  });

  constructor() {
    this.load();
  }

  load() {
    this.api.get<CodResponse>('/cod', { state: this.state() ?? undefined }).subscribe({
      next: (r) => this.d.set(r),
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }

  pick(s: CodState | null) {
    this.state.set(this.state() === s ? null : s);
    this.load();
  }

  label(o: CodRow) {
    return LABELS[o.refused_at ? 'refused' : o.cod_status];
  }

  /** a manual decision wins over the automatic limit */
  allowed(r: Refuser) {
    return r.manual ? !r.prepay_only : !this.blocked(r);
  }

  blocked(r: Refuser) {
    const limit = this.d()?.blockAfter ?? 0;
    return limit > 0 && r.refusals >= limit;
  }

  sync() {
    this.syncing.set(true);
    this.api.post<{ checked: number; updated: number }>('/np/sync', {}).subscribe({
      next: (r) => {
        this.syncing.set(false);
        this.toasts.show(`Перевірено ${r.checked}, оновлено ${r.updated}`);
        this.load();
      },
      error: (e) => {
        this.syncing.set(false);
        this.toasts.error(errorMessage(e));
      },
    });
  }

  paid(o: CodRow) {
    this.api.post(`/cod/${o.id}/paid`, {}).subscribe({
      next: () => {
        this.toasts.success(`${o.number}: гроші отримано`);
        this.load();
      },
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }

  async refused(o: CodRow) {
    if (!(await this.confirm.ask(`Позначити, що ${o.customer_name} не забрала посилку ${o.number}?`, { confirmLabel: 'Не забрали', danger: true }))) return;
    this.api.post(`/cod/${o.id}/refused`, {}).subscribe({
      next: () => this.load(),
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }

  flag(phone: string, prepayOnly: boolean) {
    this.api.put('/customer-flags', { phone, prepay_only: prepayOnly }).subscribe({
      next: () => {
        this.toasts.success(prepayOnly ? 'Для цього номера тепер лише передоплата' : 'Накладений платіж знову дозволено');
        this.load();
      },
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }
}
