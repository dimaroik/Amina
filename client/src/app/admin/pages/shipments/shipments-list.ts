import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { Icon } from '../../../shared/icon';
import { UahPipe } from '../../../shared/uah.pipe';
import { AdminApi, type Shipment } from '../../admin-api';

@Component({
  selector: 'app-admin-shipments',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe, DecimalPipe, Icon, UahPipe],
  template: `
    <div class="adm-page">
      <div class="adm-page-head">
        <div><h1>Поставки</h1><div class="sub">Партії товару від постачальників: собівартість з доставкою, оприбуткування на склад</div></div>
        <div class="actions"><a class="btn btn-sm" routerLink="/admin/shipments/new"><app-icon name="plus" [size]="15" /> Нова поставка</a></div>
      </div>

      @if (items().length) {
        <div class="adm-grid adm-grid-3" style="margin-bottom:16px">
          <div class="adm-card adm-kpi"><div class="k">В дорозі</div><div class="v">{{ inTransit() }}</div></div>
          <div class="adm-card adm-kpi"><div class="k">Вкладено в товар (усього)</div><div class="v">{{ invested() | uah }}</div></div>
          <div class="adm-card adm-kpi"><div class="k">Очікуваний прибуток</div><div class="v">{{ profit() | uah }}</div></div>
        </div>
      }

      <div class="adm-card">
        @if (items().length) {
          <div class="adm-table-wrap">
            <table class="adm-table">
              <thead><tr><th>Поставка</th><th>Статус</th><th class="num">Одиниць</th><th class="num">Сума</th><th class="num">Собівартість</th><th class="num">Маржа</th></tr></thead>
              <tbody>
                @for (s of items(); track s.id) {
                  <tr class="clickable" (click)="router.navigate(['/admin/shipments', s.id])">
                    <td class="primary">
                      <div class="adm-cell-main">
                        <div class="thumbs">
                          @for (img of s.previews ?? []; track img) { <img [src]="img" class="adm-thumb-sm" alt="" /> }
                          @if (!(s.previews ?? []).length) { <span class="adm-thumb-sm empty"><app-icon name="parcel" [size]="16" /></span> }
                        </div>
                        <div><div class="t">{{ s.title }}</div><div class="s">{{ s.supplier || '—' }} · {{ s.ordered_at | date: 'dd.MM.yyyy' }}</div></div>
                      </div>
                    </td>
                    <td data-label="Статус">
                      @if (s.status === 'received') { <span class="adm-pill ok">Оприбутковано</span> } @else { <span class="adm-pill warn">В дорозі</span> } @if (s.status === 'in_transit' && s.preorder_enabled) { <span class="adm-pill">передзамовлення</span> } @else if (s.status === 'in_transit' && s.show_incoming) { <span class="adm-pill">«в дорозі» на сайті</span> }
                    </td>
                    <td class="num" data-label="Одиниць">{{ s.totals.units }}</td>
                    <td class="num" data-label="Сума">{{ s.totals.total | number: '1.0-2' }} {{ s.currency }}</td>
                    <td class="num" data-label="Собівартість">{{ s.totals.total_uah | uah }}</td>
                    <td class="num" data-label="Маржа">{{ s.totals.margin !== null ? (s.totals.margin | number: '1.0-0') + '%' : '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else if (loaded()) {
          <div class="adm-empty">
            <app-icon name="parcel" [size]="36" />
            <div class="t">Поставок ще немає</div>
            <div>Створіть першу: вкажіть суму посилки, курс і доставку — система порахує собівартість кожної речі</div>
            <a class="btn btn-sm" routerLink="/admin/shipments/new" style="margin-top:12px">Нова поставка</a>
          </div>
        } @else {
          <div class="adm-empty"><span class="spinner"></span></div>
        }
      </div>
    </div>
  `,
  styles: `
    .thumbs { display: flex; }
    .thumbs .adm-thumb-sm { margin-left: -10px; border: 2px solid var(--surface); }
    .thumbs .adm-thumb-sm:first-child { margin-left: 0; }
    .empty { display: grid; place-items: center; color: var(--muted); }
  `,
})
export class ShipmentsListPage {
  private api = inject(AdminApi);
  protected router = inject(Router);
  protected items = signal<Shipment[]>([]);
  protected loaded = signal(false);
  protected inTransit = computed(() => this.items().filter((s) => s.status === 'in_transit').length);
  protected invested = computed(() => this.items().reduce((n, s) => n + s.totals.total_uah, 0));
  protected profit = computed(() => this.items().reduce((n, s) => n + s.totals.expected_profit, 0));

  constructor() {
    this.api.get<Shipment[]>('/shipments').subscribe((r) => {
      this.items.set(r);
      this.loaded.set(true);
    });
  }
}
