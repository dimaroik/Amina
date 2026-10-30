import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../../core/api.service';
import { Toasts } from '../../../core/toast.service';
import { Icon } from '../../../shared/icon';
import { UahPipe } from '../../../shared/uah.pipe';
import { AdminApi, type RestockLine, type RestockProduct, type RestockReport } from '../../admin-api';

const PERIODS = [30, 60, 90, 180];
const TARGETS = [30, 45, 60, 90];

@Component({
  selector: 'app-admin-restock',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, UahPipe, DatePipe, DecimalPipe],
  template: `
    <div class="adm-page">
      <div class="adm-page-head">
        <div>
          <h1>Що дозамовити</h1>
          <div class="sub">Продажі за {{ days() }} днів → що закінчується, що лежить, як окупились поставки.</div>
        </div>
        <div class="adm-seg">
          @for (d of periods; track d) { <button [class.active]="days() === d" (click)="days.set(d); load()">{{ d }} днів</button> }
        </div>
      </div>

      @if (r(); as r) {
        <div class="adm-grid adm-grid-4">
          <div class="adm-card adm-kpi">
            <div class="k"><app-icon name="bag" [size]="15" /> Продано</div>
            <div class="v">{{ r.summary.sold }} шт.</div>
            <div class="d flat">на {{ r.summary.revenue | uah }} (до знижок)</div>
          </div>
          <div class="adm-card adm-kpi">
            <div class="k"><app-icon name="parcel" [size]="15" /> Валовий прибуток</div>
            @if (r.summary.profit !== null) {
              <div class="v">{{ r.summary.profit | uah }}</div>
              <div class="d flat">маржа {{ r.summary.margin | number: '1.0-0' }}%@if (r.summary.profit_coverage < 99) { · по {{ r.summary.profit_coverage | number: '1.0-0' }}% продажів }</div>
            } @else {
              <div class="v">—</div>
              <div class="d flat">з'явиться після першої поставки</div>
            }
          </div>
          <div class="adm-card adm-kpi">
            <div class="k"><app-icon name="refresh" [size]="15" /> Дозамовити</div>
            <div class="v">{{ r.summary.reorder_units }} шт.</div>
            <div class="d flat">{{ r.summary.sold_out }} варіант(ів) уже закінчились</div>
          </div>
          <div class="adm-card adm-kpi">
            <div class="k"><app-icon name="clock" [size]="15" /> Лежить без руху</div>
            <div class="v">{{ (r.summary.dead_cost || r.summary.dead_retail) | uah }}</div>
            <div class="d flat">{{ r.summary.dead_units }} шт. · {{ r.summary.dead_cost ? 'за собівартістю' : 'за ціною продажу' }}</div>
          </div>
        </div>

        <!-- REORDER -->
        <section class="adm-card">
          <div class="adm-card-head">
            <h2>Список до замовлення</h2>
            <div class="adm-row" style="gap:6px">
              <label class="adm-hint" for="target">Запас на</label>
              <select id="target" class="select sm" (change)="target.set(+$any($event.target).value); load()">
                @for (t of targets; track t) { <option [value]="t" [selected]="t === target()">{{ t }} днів</option> }
              </select>
              <button class="btn btn-ghost btn-sm" (click)="copyList()" [disabled]="!r.reorder.length"><app-icon name="copy" [size]="14" /> Копіювати</button>
              <button class="btn btn-ghost btn-sm" (click)="csv()" [disabled]="!r.reorder.length"><app-icon name="download" [size]="14" /> CSV</button>
            </div>
          </div>
          @if (r.reorder.length) {
            <div class="adm-table-wrap">
              <table class="adm-table">
                <thead><tr><th>Товар</th><th>Що саме й скільки</th><th class="num">Продано</th><th class="num">Є + їде</th><th class="num">Замовити</th></tr></thead>
                <tbody>
                  @for (p of r.reorder; track p.product_id) {
                    <tr>
                      <td class="primary">
                        <div class="adm-cell-main">
                          @if (p.image) { <img [src]="p.image" class="adm-thumb-sm" alt="" /> } @else { <span class="adm-thumb-sm"></span> }
                          <div>
                            <a class="t link-plain" [routerLink]="['/admin/products', p.product_id]">{{ p.name }}</a>
                            <div class="s">{{ p.price | uah }}@if (p.unit_cost) { · собів. {{ p.unit_cost | uah }} }@if (p.margin !== null) { · маржа {{ p.margin | number: '1.0-0' }}% }</div>
                          </div>
                        </div>
                      </td>
                      <td data-label="Варіанти">
                        <div class="lines">
                          @for (l of p.lines; track l.variant_id) {
                            <span class="line" [class.out]="l.sold_out" [title]="lineTitle(l)">
                              @if (l.color_hex) { <span class="sw" [style.background]="l.color_hex"></span> }
                              {{ variant(l) }} @if (l.suggest) { <b>+{{ l.suggest }}</b> } @else { <span class="adm-muted">0</span> }
                              @if (l.waiting) { <span class="bell" title="Чекають на сповіщення">🔔{{ l.waiting }}</span> }
                            </span>
                          }
                        </div>
                      </td>
                      <td class="num" data-label="Продано">{{ p.sold }}</td>
                      <td class="num" data-label="Є + їде">{{ p.stock }}@if (p.incoming) { <span class="adm-muted"> + {{ p.incoming }}</span> }</td>
                      <td class="num" data-label="Замовити"><b class="big">{{ p.suggest }}</b></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <p class="adm-hint foot">Рахуємо, скільки продасться за {{ target() }} днів у темпі останніх {{ days() }} днів, мінус залишок і те, що вже їде. Враховуємо й тих, хто чекає на «Повідомити про наявність». Червоним — уже закінчилось.</p>
          } @else {
            <div class="adm-empty"><app-icon name="check" [size]="30" /><div class="t">Поки нічого дозамовляти</div><div>Залишків вистачить на {{ target() }} днів у поточному темпі продажів.</div></div>
          }
        </section>

        <div class="adm-grid adm-grid-2">
          <!-- TOP -->
          <section class="adm-card">
            <div class="adm-card-head"><h2>Хіти продажів</h2></div>
            @if (r.top.length) {
              <div class="adm-table-wrap">
                <table class="adm-table">
                  <thead><tr><th>Товар</th><th class="num">Шт.</th><th class="num">Виручка</th><th class="num">Маржа</th></tr></thead>
                  <tbody>
                    @for (p of r.top; track p.product_id; let i = $index) {
                      <tr>
                        <td class="primary"><div class="adm-cell-main"><span class="rank">{{ i + 1 }}</span>
                          @if (p.image) { <img [src]="p.image" class="adm-thumb-sm" alt="" /> } @else { <span class="adm-thumb-sm"></span> }
                          <a class="t link-plain clamp" [routerLink]="['/admin/products', p.product_id]">{{ p.name }}</a></div></td>
                        <td class="num" data-label="Шт.">{{ p.sold }}</td>
                        <td class="num" data-label="Виручка">{{ p.revenue | uah }}</td>
                        <td class="num" data-label="Маржа">{{ p.margin !== null ? (p.margin | number: '1.0-0') + '%' : '—' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else { <div class="adm-empty"><div>За цей період продажів ще не було</div></div> }
          </section>

          <!-- SIZES / COLOURS -->
          <section class="adm-card">
            <div class="adm-card-head">
              <h2>Що беруть</h2>
              <div class="adm-seg sm">
                <button [class.active]="facet() === 'size'" (click)="facet.set('size')">Розміри</button>
                <button [class.active]="facet() === 'color'" (click)="facet.set('color')">Кольори</button>
              </div>
            </div>
            <div class="adm-card-body">
              @if (bars().length) {
                <ul class="bars" [attr.aria-label]="facet() === 'size' ? 'Продано за розмірами' : 'Продано за кольорами'">
                  @for (b of bars(); track b.name) {
                    <li [title]="b.name + ': продано ' + b.sold + ' шт., на складі ' + b.stock + ' шт.'">
                      <span class="bl">@if (facet() === 'color') { <span class="sw" [style.background]="b.hex || '#ccc'"></span> }{{ b.name }}</span>
                      <span class="track"><span class="fill" [style.width.%]="b.pct"></span></span>
                      <span class="bv">{{ b.sold }}</span>
                      <span class="bs adm-muted">{{ b.share }}%</span>
                    </li>
                  }
                </ul>
                <p class="adm-hint" style="margin:12px 0 0">Частка від усіх проданих штук за {{ days() }} днів. Наведіть на рядок — побачите залишок.</p>
              } @else { <div class="adm-empty"><div>Немає продажів за період</div></div> }
            </div>
          </section>
        </div>

        <!-- DEAD STOCK -->
        <section class="adm-card">
          <div class="adm-card-head"><h2>Лежить без руху</h2><span class="adm-hint">Без продажів понад {{ r.params.dead }} днів</span></div>
          @if (r.dead.length) {
            <div class="adm-table-wrap">
              <table class="adm-table">
                <thead><tr><th>Товар</th><th>Варіанти</th><th class="num">Шт.</th><th class="num">Заморожено</th><th class="num">Без продажів</th><th></th></tr></thead>
                <tbody>
                  @for (d of r.dead; track d.product_id) {
                    <tr>
                      <td class="primary"><div class="adm-cell-main">
                        @if (d.image) { <img [src]="d.image" class="adm-thumb-sm" alt="" /> } @else { <span class="adm-thumb-sm"></span> }
                        <div><a class="t link-plain" [routerLink]="['/admin/products', d.product_id]">{{ d.name }}</a>
                          <div class="s">{{ d.price | uah }}@if (!d.is_active) { · <span class="adm-pill">прихований</span> }</div></div></div></td>
                      <td data-label="Варіанти"><span class="small clamp2">{{ d.sizes.join(', ') }}</span></td>
                      <td class="num" data-label="Шт.">{{ d.units }}</td>
                      <td class="num" data-label="Заморожено">
                        @if (d.cost_value !== null) { <b>{{ d.cost_value | uah }}</b>@if (d.cost_partial) { <span class="adm-muted">*</span> } }
                        @else { <span class="adm-muted" title="Собівартість невідома — показано за ціною продажу">≈ {{ d.retail_value | uah }}</span> }
                      </td>
                      <td class="num" data-label="Без продажів">{{ d.days_idle }} дн.@if (d.last_sale_at) { <div class="adm-muted tiny">ост. {{ d.last_sale_at | date: 'dd.MM.yy' }}</div> }</td>
                      <td><a class="btn btn-ghost btn-xs" [routerLink]="['/admin/products', d.product_id]">Знижка</a></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <p class="adm-hint foot">Ідеї: знижка 15–25%, промокод у сторіс, поставити в «Рекомендовані» на головній або продати комплектом із хітом.</p>
          } @else {
            <div class="adm-empty"><app-icon name="check" [size]="30" /><div class="t">Залежалого товару немає</div><div>Усе, що є на складі, продавалось за останні {{ r.params.dead }} днів.</div></div>
          }
        </section>

        <!-- SHIPMENTS -->
        <section class="adm-card">
          <div class="adm-card-head"><h2>Окупність поставок</h2><span class="adm-hint">Продажі речей з поставки після її надходження</span></div>
          @if (r.shipments.length) {
            <div class="adm-table-wrap">
              <table class="adm-table">
                <thead><tr><th>Поставка</th><th class="num">Продано</th><th class="num">Собівартість</th><th class="num">Виручка</th><th>Окупність</th></tr></thead>
                <tbody>
                  @for (s of r.shipments; track s.id) {
                    <tr>
                      <td class="primary"><a class="t link-plain" [routerLink]="['/admin/shipments', s.id]">{{ s.title }}</a><div class="adm-muted tiny">{{ s.received_at | date: 'dd.MM.yyyy' }}</div></td>
                      <td class="num" data-label="Продано">{{ s.sold }} з {{ s.units }} <span class="adm-muted">({{ s.sell_through | number: '1.0-0' }}%)</span></td>
                      <td class="num" data-label="Собівартість">{{ s.cost | uah }}</td>
                      <td class="num" data-label="Виручка">{{ s.revenue | uah }}</td>
                      <td data-label="Окупність">
                        <div class="payback" [title]="'Виручка покриває ' + (s.payback ?? 0) + '% вкладених грошей'">
                          <span class="track"><span class="fill" [class.ok]="(s.payback ?? 0) >= 100" [style.width.%]="min100(s.payback ?? 0)"></span></span>
                          <span class="small">{{ s.payback !== null ? (s.payback | number: '1.0-0') + '%' : '—' }}</span>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <div class="adm-empty"><div>Оприбуткованих поставок за рік ще немає</div></div>
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
    .select.sm { min-height: 32px; padding: 4px 28px 4px 10px; width: auto; font-size: 13px; }
    .lines { display: flex; flex-wrap: wrap; gap: 6px; }
    .line { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-size: 12.5px; white-space: nowrap; }
    .line b { font-weight: 700; }
    .line.out { border-color: color-mix(in srgb, var(--danger) 40%, transparent); background: color-mix(in srgb, var(--danger) 6%, var(--surface)); }
    .bell { font-size: 11px; }
    .sw { width: 10px; height: 10px; border-radius: 50%; border: 1px solid rgba(0,0,0,.12); flex: none; display: inline-block; }
    .big { font-size: 16px; }
    .foot { margin: 0; padding: 12px 18px; border-top: 1px solid var(--line); }
    .rank { width: 18px; color: var(--muted); font-size: 12px; text-align: right; flex: none; }
    .clamp { display: block; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .clamp2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 260px; }
    .adm-seg.sm button { padding: 4px 10px; font-size: 12px; }
    .bars { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .bars li { display: grid; grid-template-columns: 96px 1fr 36px 40px; align-items: center; gap: 10px; padding: 4px 0; border-radius: 4px; }
    .bars li:hover { background: var(--surface-2); }
    .bl { display: flex; align-items: center; gap: 6px; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .track { height: 10px; background: var(--surface-2); border-radius: 0 4px 4px 0; overflow: hidden; display: block; }
    .fill { display: block; height: 100%; background: var(--accent); border-radius: 0 4px 4px 0; min-width: 2px; }
    .fill.ok { background: var(--success); }
    .bv { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; font-size: 13px; }
    .bs { text-align: right; font-size: 12px; font-variant-numeric: tabular-nums; }
    .payback { display: grid; grid-template-columns: minmax(80px, 1fr) 44px; align-items: center; gap: 8px; min-width: 140px; }
  `,
})
export class RestockPage {
  private api = inject(AdminApi);
  private toasts = inject(Toasts);
  protected periods = PERIODS;
  protected targets = TARGETS;
  protected days = signal(60);
  protected target = signal(45);
  protected facet = signal<'size' | 'color'>('size');
  protected r = signal<RestockReport | null>(null);

  protected bars = computed(() => {
    const r = this.r();
    if (!r) return [];
    const list = (this.facet() === 'size' ? r.sizes : r.colors).filter((x) => x.sold > 0).slice(0, 12);
    const max = Math.max(1, ...list.map((x) => x.sold));
    const total = list.reduce((n, x) => n + x.sold, 0) || 1;
    return list.map((x) => ({ ...x, pct: (x.sold / max) * 100, share: Math.round((x.sold / total) * 100) }));
  });

  constructor() {
    this.load();
  }

  load() {
    this.api.get<RestockReport>('/reports/restock', { days: this.days(), target: this.target() }).subscribe({
      next: (r) => this.r.set(r),
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }

  variant(l: RestockLine) {
    return [l.color, l.size].filter(Boolean).join(' ') || 'Без варіантів';
  }

  lineTitle(l: RestockLine) {
    return [
      `Продано: ${l.sold} шт. (${l.per_week}/тиж.)`,
      `На складі: ${l.stock}`,
      l.incoming ? `Їде: ${l.incoming}` : '',
      l.cover_days !== null ? `Вистачить на ~${l.cover_days} дн.` : '',
      l.waiting ? `Чекають сповіщення: ${l.waiting}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  min100(n: number) {
    return Math.min(100, Math.max(0, n));
  }

  private rows(): [RestockProduct, RestockLine][] {
    return (this.r()?.reorder ?? []).flatMap((p) => p.lines.filter((l) => l.suggest > 0).map((l) => [p, l] as [RestockProduct, RestockLine]));
  }

  copyList() {
    const text = (this.r()?.reorder ?? [])
      .map((p) => `${p.name}: ${p.lines.filter((l) => l.suggest > 0).map((l) => `${this.variant(l)} × ${l.suggest}`).join(', ')}`)
      .join('\n');
    navigator.clipboard?.writeText(text).then(
      () => this.toasts.success('Список скопійовано — можна вставити в чат постачальнику'),
      () => this.toasts.error('Не вдалося скопіювати'),
    );
  }

  csv() {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Товар', 'Колір', 'Розмір', 'Продано', 'На складі', 'Їде', 'Чекають', 'Замовити'];
    const lines = this.rows().map(([p, l]) => [p.name, l.color, l.size, l.sold, l.stock, l.incoming, l.waiting, l.suggest].map(esc).join(','));
    const blob = new Blob([`﻿${[head.map(esc).join(','), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dozamovyty-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
