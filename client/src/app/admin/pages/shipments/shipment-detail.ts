import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Subject, debounceTime, switchMap, of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { errorMessage } from '../../../core/api.service';
import { Toasts } from '../../../core/toast.service';
import { Icon } from '../../../shared/icon';
import { UahPipe } from '../../../shared/uah.pipe';
import { AdminApi, type Currency, type Shipment, type ShipmentItem, type VariantSearchRow } from '../../admin-api';
import { Confirm } from '../../ui/confirm';
import { ShipmentNewProductDialog } from './new-product-dialog';

const CURRENCIES: { v: Currency; l: string }[] = [
  { v: 'USD', l: 'USD, $' },
  { v: 'CNY', l: 'CNY, ¥' },
  { v: 'EUR', l: 'EUR, €' },
  { v: 'UAH', l: 'UAH, ₴' },
];

interface Header {
  title: string;
  supplier: string;
  currency: Currency;
  exchange_rate: number;
  extra_cost: number;
  allocation: 'value' | 'quantity';
  tracking: string;
  note: string;
  ordered_at: string;
}

@Component({
  selector: 'app-admin-shipment',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, DatePipe, DecimalPipe, Icon, UahPipe, ShipmentNewProductDialog],
  template: `
    <div class="adm-page">
      <a routerLink="/admin/shipments" class="adm-back"><app-icon name="arrow-left" [size]="14" /> Усі поставки</a>
      <div class="adm-page-head">
        <div>
          <h1>{{ isNew() ? 'Нова поставка' : h.title }}</h1>
          @if (s(); as s) {
            <div class="sub">
              @if (s.status === 'received') { <span class="adm-pill ok">Оприбутковано {{ s.received_at | date: 'dd.MM.yyyy' }}</span> }
              @else { <span class="adm-pill warn">В дорозі</span> }
            </div>
          }
        </div>
        @if (s(); as s) {
          @if (s.status === 'in_transit') {
            <div class="actions"><button class="btn btn-sm" [disabled]="!s.items.length || busy()" (click)="receive()"><app-icon name="check" [size]="15" /> Оприбуткувати</button></div>
          }
        }
      </div>

      <div class="adm-split">
        <div class="adm-stack">
          <section class="adm-card">
            <div class="adm-card-head"><h2>Посилка</h2>@if (locked()) { <span class="adm-hint">Після оприбуткування суми не змінюються</span> }</div>
            <div class="adm-card-body">
              <div class="form-grid">
                <div class="field"><label class="label">Назва *</label><input class="input" [(ngModel)]="h.title" placeholder="Китай #3, жовтень" /></div>
                <div class="field"><label class="label">Постачальник / магазин</label><input class="input" [(ngModel)]="h.supplier" placeholder="Taobao, 1688, Poizon…" /></div>
                <div class="field"><label class="label">Дата замовлення</label><input class="input" type="date" [(ngModel)]="h.ordered_at" [disabled]="locked()" /></div>
                <div class="field"><label class="label">Трек-номер</label><input class="input" [(ngModel)]="h.tracking" /></div>
                <div class="field"><label class="label">Валюта</label>
                  <select class="select" [(ngModel)]="h.currency" (ngModelChange)="onCurrency()" [disabled]="locked()">@for (c of currencies; track c.v) { <option [value]="c.v">{{ c.l }}</option> }</select></div>
                <div class="field"><label class="label">Курс, ₴ за 1 {{ h.currency }}</label>
                  <div class="adm-row nowrap">
                    <input class="input" type="number" min="0" step="0.01" [(ngModel)]="h.exchange_rate" [disabled]="locked() || h.currency === 'UAH'" />
                    @if (h.currency !== 'UAH' && !locked()) { <button class="btn btn-ghost btn-xs" (click)="loadRate()" title="Офіційний курс НБУ на сьогодні">НБУ</button> }
                  </div></div>
                <div class="field"><label class="label">Доставка, комісії, мито, {{ h.currency }}</label>
                  <input class="input" type="number" min="0" step="0.01" [(ngModel)]="h.extra_cost" [disabled]="locked()" />
                  <div class="adm-hint">Знаєте лише загальну суму посилки? Впишіть її сюди, а ціни товарів залиште 0 — сума поділиться порівну.</div></div>
                <div class="field"><label class="label">Як ділити доставку між речами</label>
                  <select class="select" [(ngModel)]="h.allocation" [disabled]="locked()">
                    <option value="value">Пропорційно ціні речі</option><option value="quantity">Порівну на кожну одиницю</option></select></div>
                <div class="field full"><label class="label">Нотатка</label><textarea class="textarea" rows="2" [(ngModel)]="h.note"></textarea></div>
              </div>
              <div class="adm-row" style="justify-content:flex-end;margin-top:12px">
                <button class="btn btn-sm" [disabled]="busy() || !h.title.trim() || !(h.exchange_rate > 0)" (click)="saveHeader()">{{ isNew() ? 'Створити поставку' : 'Зберегти' }}</button>
              </div>
            </div>
          </section>

          @if (s(); as s) {
            <section class="adm-card">
              <div class="adm-card-head">
                <h2>Товари ({{ s.totals.units }} шт.)</h2>
                @if (!locked()) {
                  <div class="adm-row" style="gap:6px">
                    <button class="btn btn-ghost btn-sm" (click)="searchOpen.set(!searchOpen())"><app-icon name="search" [size]="14" /> Наявний товар</button>
                    <button class="btn btn-sm" (click)="newOpen.set(true)"><app-icon name="plus" [size]="14" /> Новий товар</button>
                  </div>
                }
              </div>
              @if (searchOpen() && !locked()) {
                <div class="search-box">
                  <input class="input" placeholder="Назва або артикул товару" (input)="q$.next($any($event.target).value)" autofocus />
                  @if (found().length) {
                    <ul class="found">
                      @for (v of found(); track v.id) {
                        <li>
                          @if (v.image) { <img [src]="v.image" class="adm-thumb-sm" alt="" /> }
                          <span class="small" style="flex:1">{{ v.name }} <span class="adm-muted">{{ v.color }} {{ v.size }} · на складі {{ v.stock }}</span></span>
                          <input class="input mini" type="number" min="1" [(ngModel)]="addQty[v.id]" placeholder="к-сть" />
                          <input class="input mini" type="number" min="0" step="0.01" [(ngModel)]="addPrice[v.id]" [placeholder]="h.currency" />
                          <button class="btn btn-xs" (click)="addExisting(v)">Додати</button>
                        </li>
                      }
                    </ul>
                  }
                </div>
              }
              @if (s.items.length) {
                <div class="adm-table-wrap">
                  <table class="adm-table">
                    <thead><tr><th>Товар</th><th class="num">К-сть</th><th class="num">Ціна, {{ s.currency }}</th><th class="num">Собівартість 1 шт.</th><th class="num">Продаж</th><th class="num">Маржа</th><th></th></tr></thead>
                    <tbody>
                      @for (i of s.items; track i.id) {
                        <tr>
                          <td class="primary">
                            <div class="adm-cell-main">
                              @if (i.image) { <img [src]="i.image" class="adm-thumb-sm" alt="" /> } @else { <span class="adm-thumb-sm"></span> }
                              <div>
                                @if (i.product_id) { <a class="t link-plain" [routerLink]="['/admin/products', i.product_id]">{{ i.name }}</a> } @else { <div class="t">{{ i.name }}</div> }
                                <div class="s">{{ variantLabel(i) }}@if (i.activate_on_receive && s.status === 'in_transit') { · <span class="adm-pill">новий, прихований</span> }</div>
                              </div>
                            </div>
                          </td>
                          <td class="num" data-label="К-сть">
                            @if (locked()) { {{ i.quantity }} } @else { <input class="input mini" type="number" min="1" [ngModel]="i.quantity" (change)="patch(i, { quantity: +$any($event.target).value })" /> }
                          </td>
                          <td class="num" data-label="Ціна">
                            @if (locked()) { {{ i.unit_price | number: '1.0-2' }} } @else { <input class="input mini" type="number" min="0" step="0.01" [ngModel]="i.unit_price" (change)="patch(i, { unit_price: +$any($event.target).value })" /> }
                          </td>
                          <td class="num" data-label="Собівартість"><b>{{ i.unit_cost | uah }}</b></td>
                          <td class="num" data-label="Продаж">{{ i.sale_price | uah }}</td>
                          <td class="num" data-label="Маржа"><span class="adm-pill" [class.ok]="(i.margin ?? 0) >= 40" [class.warn]="(i.margin ?? 0) < 40 && (i.margin ?? 0) >= 15" [class.danger]="(i.margin ?? 0) < 15">{{ i.margin !== null ? (i.margin | number: '1.0-0') + '%' : '—' }}</span></td>
                          <td>@if (!locked()) { <button class="icon-btn" (click)="removeItem(i)" title="Прибрати"><app-icon name="trash" [size]="15" /></button> }</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              } @else {
                <div class="adm-empty"><app-icon name="parcel" [size]="32" /><div class="t">Додайте речі з цієї посилки</div><div>Новий товар створиться прихованим і з'явиться на сайті після оприбуткування</div></div>
              }
            </section>
          }
        </div>

        @if (s(); as s) {
          <aside class="adm-card pad summary">
            <div class="adm-section-title">Підсумок</div>
            <dl class="adm-kv">
              <dt>Товари</dt><dd>{{ s.totals.goods | number: '1.0-2' }} {{ s.currency }}</dd>
              <dt>Доставка й інше</dt><dd>{{ s.totals.extra | number: '1.0-2' }} {{ s.currency }}</dd>
              <dt>Разом</dt><dd><b>{{ s.totals.total | number: '1.0-2' }} {{ s.currency }}</b></dd>
              @if (s.currency !== 'UAH') { <dt>Курс</dt><dd>{{ s.exchange_rate }} ₴</dd> }
            </dl>
            <div class="adm-sep"></div>
            <div class="big"><span class="adm-muted small">Собівартість партії</span><b>{{ s.totals.total_uah | uah }}</b></div>
            <div class="big"><span class="adm-muted small">В середньому за 1 шт.</span><b>{{ s.totals.avg_unit_uah | uah }}</b></div>
            <div class="adm-sep"></div>
            <div class="big"><span class="adm-muted small">Очікувана виручка</span><b>{{ s.totals.expected_revenue | uah }}</b></div>
            <div class="big"><span class="adm-muted small">Очікуваний прибуток</span><b [class.neg]="s.totals.expected_profit < 0">{{ s.totals.expected_profit | uah }}</b></div>
            @if (s.totals.margin !== null) { <div class="adm-hint">Маржа {{ s.totals.margin | number: '1.0-0' }}% — за умови продажу всіх речей за поточними цінами.</div> }
            @if (s.status === 'in_transit') {
              <div class="adm-sep"></div>
              <p class="adm-hint" style="margin:0">«Оприбуткувати» — коли посилка приїхала: залишки додадуться на склад, собівартість запишеться в товари, нові товари з'являться на сайті.</p>
              <button class="btn btn-ghost btn-xs del" (click)="remove()">Видалити поставку</button>
            }
          </aside>
        }
      </div>
    </div>

    @if (newOpen() && s(); as s) {
      <adm-shipment-new-product [shipmentId]="s.id" [currency]="s.currency" (close)="newOpen.set(false)" (added)="onAdded($event)" />
    }
  `,
  styles: `
    .nowrap { flex-wrap: nowrap; }
    .full { grid-column: 1 / -1; }
    .mini { width: 84px !important; min-height: 32px !important; padding: 4px 8px !important; text-align: right; }
    .search-box { padding: 12px 18px; border-bottom: 1px solid var(--line); background: #fbfaf7; }
    .found { list-style: none; margin: 8px 0 0; padding: 0; max-height: 300px; overflow: auto; }
    .found li { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--line); }
    .summary { position: sticky; top: 76px; display: flex; flex-direction: column; gap: 10px; }
    .big { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
    .big b { font-size: 18px; font-variant-numeric: tabular-nums; }
    .neg { color: var(--danger); }
    .del { color: var(--danger); align-self: flex-start; }
  `,
})
export class ShipmentDetailPage {
  private api = inject(AdminApi);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  private router = inject(Router);
  readonly id = input<string>();

  protected currencies = CURRENCIES;
  protected s = signal<Shipment | null>(null);
  protected busy = signal(false);
  protected newOpen = signal(false);
  protected searchOpen = signal(false);
  protected found = signal<VariantSearchRow[]>([]);
  protected addQty: Record<number, number> = {};
  protected addPrice: Record<number, number> = {};
  protected q$ = new Subject<string>();
  protected h: Header = this.blank();

  protected isNew = computed(() => !this.id() || this.id() === 'new');
  protected locked = computed(() => this.s()?.status === 'received');

  constructor() {
    effect(() => {
      if (this.isNew()) {
        this.s.set(null);
        this.h = this.blank();
        this.loadRate(true);
        return;
      }
      this.api.get<Shipment>(`/shipments/${this.id()}`).subscribe({
        next: (s) => this.apply(s),
        error: (e) => {
          this.toasts.error(errorMessage(e));
          this.router.navigateByUrl('/admin/shipments');
        },
      });
    });
    this.q$
      .pipe(
        debounceTime(250),
        switchMap((q) => (q.trim().length < 2 ? of([]) : this.api.get<VariantSearchRow[]>('/variants/search', { q }))),
        takeUntilDestroyed(),
      )
      .subscribe((r) => this.found.set(r));
  }

  private blank(): Header {
    return { title: '', supplier: '', currency: 'USD', exchange_rate: 41, extra_cost: 0, allocation: 'value', tracking: '', note: '', ordered_at: new Date().toISOString().slice(0, 10) };
  }

  private apply(s: Shipment) {
    this.s.set(s);
    this.h = {
      title: s.title, supplier: s.supplier, currency: s.currency, exchange_rate: Number(s.exchange_rate), extra_cost: Number(s.extra_cost),
      allocation: s.allocation, tracking: s.tracking, note: s.note, ordered_at: String(s.ordered_at).slice(0, 10),
    };
  }

  variantLabel(i: ShipmentItem) {
    return [i.color, i.size].filter(Boolean).join(' · ') || '—';
  }

  onCurrency() {
    if (this.h.currency === 'UAH') this.h.exchange_rate = 1;
    else this.loadRate(true);
  }

  loadRate(silent = false) {
    const currency = this.h.currency;
    if (currency === 'UAH') return;
    this.api.get<{ rate: number; date: string }>('/fx', { currency }).subscribe({
      next: (r) => {
        if (this.h.currency !== currency) return;
        this.h = { ...this.h, exchange_rate: Math.round(r.rate * 100) / 100 };
        this.s.update((s) => (s ? { ...s } : s)); // refresh view
        if (!silent) this.toasts.show(`Курс НБУ на ${r.date}: ${r.rate.toFixed(2)} ₴`);
      },
      error: (e) => !silent && this.toasts.error(errorMessage(e)),
    });
  }

  saveHeader() {
    this.busy.set(true);
    const body = { ...this.h, exchange_rate: Number(this.h.exchange_rate), extra_cost: Number(this.h.extra_cost) || 0 };
    const req = this.isNew() ? this.api.post<Shipment>('/shipments', body) : this.api.put<Shipment>(`/shipments/${this.s()!.id}`, body);
    req.subscribe({
      next: (s) => {
        this.busy.set(false);
        if (this.isNew()) {
          this.router.navigate(['/admin/shipments', s.id], { replaceUrl: true });
          this.toasts.success('Поставку створено — тепер додайте товари');
        } else {
          this.apply(s);
          this.toasts.success('Збережено');
        }
      },
      error: (e) => {
        this.busy.set(false);
        this.toasts.error(errorMessage(e));
      },
    });
  }

  private update(req: ReturnType<AdminApi['post']>) {
    (req as ReturnType<AdminApi['post']>).subscribe({
      next: (s) => this.apply(s as Shipment),
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }

  addExisting(v: VariantSearchRow) {
    const quantity = Number(this.addQty[v.id]) || 1;
    const unit_price = Number(this.addPrice[v.id]) || 0;
    this.update(this.api.post(`/shipments/${this.s()!.id}/items`, { variant_id: v.id, quantity, unit_price }));
    this.toasts.show(`Додано: ${v.name} ${v.size}`);
  }

  patch(i: ShipmentItem, body: { quantity?: number; unit_price?: number }) {
    if (body.quantity !== undefined && !(body.quantity >= 1)) return;
    this.update(this.api.patch(`/shipments/${this.s()!.id}/items/${i.id}`, body));
  }

  removeItem(i: ShipmentItem) {
    this.update(this.api.delete(`/shipments/${this.s()!.id}/items/${i.id}`));
  }

  onAdded(s: Shipment) {
    this.newOpen.set(false);
    this.apply(s);
    this.toasts.success('Товар додано в поставку');
  }

  async receive() {
    const s = this.s()!;
    const ok = await this.confirm.ask(
      `Оприбуткувати «${s.title}»? На склад додасться ${s.totals.units} шт., собівартість запишеться в товари, нові товари з'являться на сайті. Після цього суми поставки не редагуються.`,
      { confirmLabel: 'Оприбуткувати' },
    );
    if (!ok) return;
    this.busy.set(true);
    this.api.post<Shipment>(`/shipments/${s.id}/receive`, { publish: true }).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.apply(r);
        this.toasts.success('Поставку оприбутковано — залишки оновлено');
      },
      error: (e) => {
        this.busy.set(false);
        this.toasts.error(errorMessage(e));
      },
    });
  }

  async remove() {
    if (!(await this.confirm.ask('Видалити поставку? Нові товари, створені в ній і ще не показані на сайті, теж видаляться.', { danger: true, confirmLabel: 'Видалити' }))) return;
    this.api.delete(`/shipments/${this.s()!.id}`).subscribe(() => this.router.navigateByUrl('/admin/shipments'));
  }
}
