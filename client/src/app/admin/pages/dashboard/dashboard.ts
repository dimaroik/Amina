import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '../../../core/labels';
import { Icon } from '../../../shared/icon';
import { UahPipe } from '../../../shared/uah.pipe';
import { AdminApi, type Dashboard } from '../../admin-api';

const W = 800;
const H = 220;
const PAD = { t: 16, r: 8, b: 26, l: 8 };

@Component({
  selector: 'app-admin-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, UahPipe, DatePipe],
  template: `
    <div class="adm-page">
      <div class="adm-page-head">
        <div>
          <h1>Огляд</h1>
          <div class="sub">Доброго дня! Ось як ідуть справи в Amina.</div>
        </div>
        <div class="adm-seg">
          @for (d of periods; track d) {
            <button [class.active]="days() === d" (click)="load(d)">{{ d }} днів</button>
          }
        </div>
      </div>

      @if (data(); as d) {
        <div class="adm-grid adm-grid-4">
          <div class="adm-card adm-kpi">
            <div class="k"><app-icon name="card" [size]="15" /> Виручка</div>
            <div class="v">{{ d.totals.revenue | uah }}</div>
            <div class="d" [class]="'d ' + delta(d.totals.revenue, d.prev.revenue).cls">{{ delta(d.totals.revenue, d.prev.revenue).text }}</div>
          </div>
          <div class="adm-card adm-kpi">
            <div class="k"><app-icon name="box" [size]="15" /> Замовлення</div>
            <div class="v">{{ d.totals.orders }}</div>
            <div class="d" [class]="'d ' + delta(d.totals.orders, d.prev.orders).cls">{{ delta(d.totals.orders, d.prev.orders).text }}</div>
          </div>
          <div class="adm-card adm-kpi">
            <div class="k"><app-icon name="tag" [size]="15" /> Середній чек</div>
            <div class="v">{{ round(d.totals.avg_check) | uah }}</div>
            <div class="d flat">{{ d.totals.customers }} клієнтів за {{ d.days }} днів</div>
          </div>
          <div class="adm-card adm-kpi">
            <div class="k"><app-icon name="parcel" [size]="15" /> Валовий прибуток</div>
            @if (d.profit && d.profit.covered_revenue > 0) {
              <div class="v">{{ round(d.profit.gross) | uah }}</div>
              <div class="d flat" [title]="'Враховано лише товари з відомою собівартістю (з поставок або вказаною вручну)'">
                маржа {{ round(d.profit.gross / d.profit.covered_revenue * 100) }}%@if (d.profit.covered_revenue < d.profit.items_revenue) { · по {{ round(d.profit.covered_revenue / d.profit.items_revenue * 100) }}% продажів }
              </div>
            } @else {
              <div class="v">—</div>
              <div class="d flat">додайте поставки, щоб бачити прибуток</div>
            }
          </div>
        </div>

        <div class="adm-card chart-card">
          <div class="adm-card-head">
            <h2>Продажі</h2>
            <div class="legend"><span class="sw rev"></span> Виручка <span class="sw ord"></span> Замовлення</div>
          </div>
          <div class="chart" (mouseleave)="hover.set(-1)">
            <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" preserveAspectRatio="none" (mousemove)="onMove($event)" (touchstart)="onMove($event)">
              @for (g of chart().grid; track $index) {
                <line [attr.x1]="0" [attr.x2]="W" [attr.y1]="g" [attr.y2]="g" class="grid" />
              }
              @for (b of chart().bars; track $index) {
                <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h" class="bar" [class.on]="hover() === $index" />
              }
              <path [attr.d]="chart().area" class="area" />
              <path [attr.d]="chart().line" class="line" />
              @if (hover() >= 0) {
                <line [attr.x1]="chart().xs[hover()]" [attr.x2]="chart().xs[hover()]" [attr.y1]="PAD.t" [attr.y2]="H - PAD.b" class="cursor" />
              }
            </svg>
            <div class="axis">
              @for (l of chart().labels; track $index) { <span>{{ l }}</span> }
            </div>
            @if (hover() >= 0 && d.daily[hover()]; as p) {
              <div class="tip" [style.left.%]="(chart().xs[hover()] / W) * 100">
                <b>{{ p.date | date: 'd MMM, EEE' }}</b>
                <span>{{ p.revenue | uah }}</span>
                <span class="adm-muted">{{ p.orders }} замовл.</span>
              </div>
            }
          </div>
        </div>

        <div class="adm-grid adm-grid-3">
          <div class="adm-card">
            <div class="adm-card-head"><h2>Останні замовлення</h2><a routerLink="/admin/orders" class="small link-plain">Усі</a></div>
            <ul class="adm-list pad-x">
              @for (o of d.recent; track o.id) {
                <li>
                  <a [routerLink]="['/admin/orders', o.id]" class="grow">
                    <div class="t">{{ o.number }} · {{ o.customer_name }}</div>
                    <div class="adm-muted tiny">{{ o.created_at | date: 'd MMM, HH:mm' }}</div>
                  </a>
                  <div class="right">
                    <div class="num">{{ o.total | uah }}</div>
                    <span class="badge" [class]="'badge badge-' + o.status">{{ statusLabels[o.status] }}</span>
                  </div>
                </li>
              } @empty {
                <li class="adm-muted">Поки що замовлень немає</li>
              }
            </ul>
          </div>

          <div class="adm-card">
            <div class="adm-card-head"><h2>Статуси замовлень</h2></div>
            <div class="adm-card-body">
              @for (s of statusBars(); track s.status) {
                <a class="sbar" [routerLink]="['/admin/orders']" [queryParams]="{ status: s.status }">
                  <span class="lbl">{{ statusLabels[s.status] }}</span>
                  <span class="track"><span class="fill" [class]="'fill badge-' + s.status" [style.width.%]="s.pct"></span></span>
                  <span class="num">{{ s.count }}</span>
                </a>
              } @empty {
                <p class="adm-muted">Немає даних</p>
              }
              @if (d.chats.waiting > 0) {
                <a routerLink="/admin/chats" class="chat-alert">
                  <app-icon name="chat" [size]="16" /> {{ d.chats.waiting }} клієнт(и) чекають відповіді менеджера
                </a>
              }
              <p class="adm-hint" style="margin-top:12px">Чат-бот: {{ d.chats.today }} розмов за добу</p>
            </div>
          </div>

          <div class="adm-stack">
            <div class="adm-card">
              <div class="adm-card-head"><h2>Топ товарів</h2></div>
              <ul class="adm-list pad-x">
                @for (t of d.top; track t.name) {
                  <li>
                    @if (t.image) { <img [src]="t.image" class="adm-thumb-sm" alt="" /> }
                    <div class="grow">
                      <div class="t clamp">{{ t.name }}</div>
                      <div class="adm-muted tiny">{{ t.qty }} шт · {{ t.revenue | uah }}</div>
                    </div>
                  </li>
                } @empty {
                  <li class="adm-muted">Немає продажів за період</li>
                }
              </ul>
            </div>
            <div class="adm-card">
              <div class="adm-card-head"><h2>Закінчуються</h2><a routerLink="/admin/products" [queryParams]="{ status: 'low' }" class="small link-plain">Усі</a></div>
              <ul class="adm-list pad-x">
                @for (l of d.lowStock; track $index) {
                  <li>
                    <a [routerLink]="['/admin/products', l.id]" class="grow">
                      <div class="t clamp">{{ l.name }}</div>
                      <div class="adm-muted tiny">{{ l.size }}{{ l.color ? ' · ' + l.color : '' }}</div>
                    </a>
                    <span class="adm-pill" [class.danger]="l.stock === 0" [class.warn]="l.stock > 0">{{ l.stock }} шт</span>
                  </li>
                } @empty {
                  <li class="adm-muted">Усього достатньо 👌</li>
                }
              </ul>
            </div>
          </div>
        </div>
      } @else {
        <div class="adm-grid adm-grid-4">
          @for (i of [1, 2, 3, 4]; track i) { <div class="skeleton" style="height:104px;border-radius:10px"></div> }
        </div>
        <div class="skeleton" style="height:300px;border-radius:10px;margin-top:16px"></div>
      }
    </div>
  `,
  styles: `
    .adm-grid + .adm-card, .adm-card + .adm-grid { margin-top: 16px; }
    .chart-card { margin-top: 16px; }
    .legend { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
    .sw { width: 10px; height: 10px; border-radius: 2px; display: inline-block; margin-left: 8px; }
    .sw.rev { background: var(--ink); }
    .sw.ord { background: var(--accent-soft); }
    .chart { position: relative; padding: 12px 16px 8px; }
    svg { width: 100%; height: 220px; display: block; overflow: visible; }
    .grid { stroke: var(--line); stroke-width: 1; vector-effect: non-scaling-stroke; }
    .bar { fill: var(--accent-soft); opacity: .7; transition: opacity .15s; }
    .bar.on { opacity: 1; fill: var(--accent); }
    .area { fill: rgba(31,29,26,.06); }
    .line { fill: none; stroke: var(--ink); stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
    .cursor { stroke: var(--ink); stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
    .axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); margin-top: 4px; }
    .tip { position: absolute; top: 8px; transform: translateX(-50%); background: var(--ink); color: var(--bg); padding: 8px 10px; border-radius: 6px; font-size: 12px; display: flex; flex-direction: column; pointer-events: none; white-space: nowrap; box-shadow: var(--shadow); }
    .tip .adm-muted { color: #b4aba0; }
    .adm-grid-3 { margin-top: 16px; align-items: start; }
    .pad-x { padding: 4px 18px; }
    .grow { flex: 1; min-width: 0; }
    .t { font-weight: 600; font-size: 13px; }
    .clamp { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .right { text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .num { font-variant-numeric: tabular-nums; font-size: 13px; }
    .sbar { display: grid; grid-template-columns: 110px 1fr 32px; align-items: center; gap: 10px; padding: 6px 0; font-size: 13px; }
    .sbar:hover .lbl { text-decoration: underline; }
    .track { height: 8px; background: var(--surface-2); border-radius: 99px; overflow: hidden; }
    .fill { display: block; height: 100%; border-radius: 99px; background: currentColor; }
    .sbar .num { text-align: right; }
    .chat-alert { display: flex; gap: 8px; align-items: center; margin-top: 14px; padding: 10px 12px; background: #f4efe2; color: #7a5f22; border-radius: 8px; font-size: 13px; }
  `,
})
export class DashboardPage {
  private api = inject(AdminApi);
  protected readonly W = W;
  protected readonly H = H;
  protected readonly PAD = PAD;
  protected periods = [7, 30, 90];
  protected days = signal(30);
  protected data = signal<Dashboard | null>(null);
  protected hover = signal(-1);
  protected statusLabels = ORDER_STATUS_LABELS;
  protected paymentLabels = PAYMENT_STATUS_LABELS;
  protected round = Math.round;

  constructor() {
    this.load(30);
  }

  load(days: number) {
    this.days.set(days);
    this.api.get<Dashboard>('/dashboard', { days }).subscribe((d) => this.data.set(d));
  }

  delta(cur: number, prev: number): { text: string; cls: string } {
    if (!prev) return cur ? { text: 'новий період', cls: 'flat' } : { text: '—', cls: 'flat' };
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (pct === 0) return { text: 'без змін', cls: 'flat' };
    return { text: `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}% до попереднього`, cls: pct > 0 ? 'up' : 'down' };
  }

  protected statusBars = computed(() => {
    const list = this.data()?.byStatus ?? [];
    const max = Math.max(1, ...list.map((s) => s.count));
    const order = Object.keys(ORDER_STATUS_LABELS);
    return [...list].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status)).map((s) => ({ ...s, pct: (s.count / max) * 100 }));
  });

  protected chart = computed(() => {
    const daily = this.data()?.daily ?? [];
    const n = Math.max(1, daily.length);
    const innerW = W - PAD.l - PAD.r;
    const innerH = H - PAD.t - PAD.b;
    const step = innerW / n;
    const maxRev = Math.max(1, ...daily.map((d) => d.revenue));
    const maxOrd = Math.max(1, ...daily.map((d) => d.orders));
    const xs = daily.map((_, i) => PAD.l + step * i + step / 2);
    const ys = daily.map((d) => PAD.t + innerH - (d.revenue / maxRev) * innerH);
    const bars = daily.map((d, i) => {
      const h = (d.orders / maxOrd) * innerH * 0.55;
      const w = Math.max(2, step * 0.55);
      return { x: xs[i] - w / 2, y: PAD.t + innerH - h, w, h };
    });
    const line = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
    const base = PAD.t + innerH;
    const area = xs.length ? `${line} L${xs[xs.length - 1].toFixed(1)},${base} L${xs[0].toFixed(1)},${base} Z` : '';
    const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => PAD.t + innerH * f);
    const every = Math.ceil(n / 6);
    const labels = daily.filter((_, i) => i % every === 0).map((d) => d.date.slice(8, 10) + '.' + d.date.slice(5, 7));
    return { xs, bars, line, area, grid, labels };
  });

  onMove(e: MouseEvent | TouchEvent) {
    const el = e.currentTarget as SVGElement;
    const rect = el.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const n = this.data()?.daily.length ?? 0;
    if (!n) return;
    const x = ((clientX - rect.left) / rect.width) * W;
    const step = (W - PAD.l - PAD.r) / n;
    this.hover.set(Math.min(n - 1, Math.max(0, Math.floor((x - PAD.l) / step))));
  }
}
