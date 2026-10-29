import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../../core/api.service';
import type { Category, Paged } from '../../../core/models';
import { Toasts } from '../../../core/toast.service';
import { Icon } from '../../../shared/icon';
import { UahPipe } from '../../../shared/uah.pipe';
import { AdminApi, flattenCategories, type AdminProductRow } from '../../admin-api';
import { Confirm } from '../../ui/confirm';
import { Pager } from '../../ui/pager';

interface Filters {
  q: string;
  category_id: string;
  status: string;
  sort: string;
  page: number;
}

@Component({
  selector: 'app-admin-products',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Icon, UahPipe, Pager],
  template: `
    <div class="adm-page">
      <div class="adm-page-head">
        <div>
          <h1>Товари</h1>
          <div class="sub">Каталог, залишки та видимість на сайті</div>
        </div>
        <div class="actions">
          <a routerLink="/admin/products/new" class="btn btn-sm"><app-icon name="plus" [size]="15" /> Додати товар</a>
        </div>
      </div>

      <div class="adm-tabs">
        @for (s of statusTabs; track s.v) {
          <button [class.active]="f().status === s.v" (click)="set({ status: s.v })">{{ s.l }}</button>
        }
      </div>

      <div class="adm-toolbar">
        <div class="search">
          <app-icon name="search" [size]="16" />
          <input class="input" placeholder="Назва або артикул" [ngModel]="f().q" (ngModelChange)="search($event)" />
        </div>
        <select class="select" [ngModel]="f().category_id" (ngModelChange)="set({ category_id: $event })">
          <option value="">Усі категорії</option>
          @for (c of categories(); track c.id) { <option [value]="c.id">{{ c.label }}</option> }
        </select>
        <select class="select" [ngModel]="f().sort" (ngModelChange)="set({ sort: $event })">
          <option value="new">Спочатку нові</option>
          <option value="name">За назвою</option>
          <option value="price">Дорожчі</option>
          <option value="stock">Менше залишків</option>
          <option value="sales">Популярні</option>
        </select>
      </div>

      @if (selected().size) {
        <div class="bulk">
          <span>Обрано: <b>{{ selected().size }}</b></span>
          <button class="btn btn-ghost btn-xs" (click)="bulk('activate')">Показати</button>
          <button class="btn btn-ghost btn-xs" (click)="bulk('deactivate')">Приховати</button>
          <button class="btn btn-ghost btn-xs" (click)="bulk('feature')">★ На головну</button>
          <button class="btn btn-ghost btn-xs" (click)="bulk('unfeature')">Прибрати з головної</button>
          <button class="btn btn-ghost btn-xs danger" (click)="bulk('delete')">Видалити</button>
          <span class="spacer"></span>
          <button class="btn btn-ghost btn-xs" (click)="clearSelection()">Скасувати</button>
        </div>
      }

      <div class="adm-card">
        @if (data()?.items?.length) {
          <div class="adm-table-wrap">
            <table class="adm-table">
              <thead>
                <tr>
                  <th class="check"><input type="checkbox" [checked]="allSelected()" (change)="toggleAll()" aria-label="Обрати всі" /></th>
                  <th>Товар</th><th>Категорія</th><th class="num">Ціна</th><th class="num">Залишок</th><th>Статус</th><th></th>
                </tr>
              </thead>
              <tbody>
                @for (p of data()!.items; track p.id) {
                  <tr class="clickable" (click)="router.navigate(['/admin/products', p.id])">
                    <td class="check" (click)="$event.stopPropagation()"><input type="checkbox" [checked]="selected().has(p.id)" (change)="toggle(p.id)" /></td>
                    <td class="primary">
                      <div class="adm-cell-main">
                        @if (p.image) { <img [src]="p.image" class="adm-thumb" alt="" /> } @else { <span class="adm-thumb"></span> }
                        <div>
                          <div class="t">{{ p.name }} @if (p.is_featured) { <span title="На головній">★</span> }</div>
                          <div class="s">{{ p.sku || '—' }} · {{ p.variants_count }} варіант(ів) · продано {{ p.sales_count }}</div>
                        </div>
                      </div>
                    </td>
                    <td data-label="Категорія">{{ p.category_name || '—' }}</td>
                    <td class="num" data-label="Ціна">
                      {{ p.price | uah }}
                      @if (p.old_price) { <div class="adm-muted tiny strike">{{ p.old_price | uah }}</div> }
                    </td>
                    <td class="num" data-label="Залишок">
                      <span class="adm-pill" [class.danger]="p.stock === 0" [class.warn]="p.stock > 0 && p.stock <= 3">{{ p.stock }} шт</span>
                    </td>
                    <td data-label="Статус">
                      <span class="adm-pill" [class.ok]="p.is_active">{{ p.is_active ? 'На сайті' : 'Приховано' }}</span>
                    </td>
                    <td class="nowrap" (click)="$event.stopPropagation()">
                      <a class="icon-btn" [href]="'/product/' + p.slug" target="_blank" title="На сайті"><app-icon name="eye" [size]="16" /></a>
                      <button class="icon-btn" (click)="duplicate(p)" title="Дублювати"><app-icon name="copy" [size]="16" /></button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <adm-pager [page]="data()!.page" [pages]="data()!.pages" [total]="data()!.total" (go)="set({ page: $event }, false)" />
        } @else if (data()) {
          <div class="adm-empty">
            <app-icon name="tag" [size]="36" />
            <div class="t">Товарів не знайдено</div>
            <a routerLink="/admin/products/new" class="btn btn-sm" style="margin-top:12px">Додати перший товар</a>
          </div>
        } @else {
          <div class="adm-empty"><span class="spinner"></span></div>
        }
      </div>
    </div>
  `,
  styles: `
    .bulk { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 12px; margin-bottom: 10px; background: var(--ink); color: var(--bg); border-radius: 8px; font-size: 13px; }
    .bulk .btn { --btn-fg: var(--bg); }
    .bulk .btn:hover { --btn-bg: rgba(255,255,255,.12); }
    .bulk .danger { --btn-fg: #f1b5ab; }
    .spacer { flex: 1; }
    .strike { text-decoration: line-through; }
  `,
})
export class ProductsListPage {
  private api = inject(AdminApi);
  private route = inject(ActivatedRoute);
  protected router = inject(Router);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);

  protected statusTabs = [
    { v: '', l: 'Усі' },
    { v: 'active', l: 'На сайті' },
    { v: 'hidden', l: 'Приховані' },
    { v: 'low', l: 'Закінчуються' },
    { v: 'out', l: 'Немає в наявності' },
  ];
  protected f = signal<Filters>({ q: '', category_id: '', status: '', sort: 'new', page: 1 });
  protected data = signal<Paged<AdminProductRow> | null>(null);
  protected categories = signal<ReturnType<typeof flattenCategories>>([]);
  protected selected = signal(new Set<number>());
  protected allSelected = computed(() => {
    const items = this.data()?.items ?? [];
    return items.length > 0 && items.every((p) => this.selected().has(p.id));
  });
  protected readonly Set = Set;
  private searchTimer?: ReturnType<typeof setTimeout>;

  clearSelection() {
    this.selected.set(new Set());
  }

  constructor() {
    this.api.get<Category[]>('/categories').subscribe((c) => this.categories.set(flattenCategories(c)));
    this.route.queryParamMap.subscribe((p) => {
      this.f.set({
        q: p.get('q') ?? '',
        category_id: p.get('category_id') ?? '',
        status: p.get('status') ?? '',
        sort: p.get('sort') ?? 'new',
        page: Number(p.get('page') ?? 1),
      });
      this.load();
    });
  }

  set(patch: Partial<Filters>, resetPage = true) {
    const next = { ...this.f(), ...patch, ...(resetPage ? { page: 1 } : {}) };
    const qp: Record<string, string | number | null> = {};
    for (const [k, v] of Object.entries(next)) qp[k] = v && !(k === 'page' && v === 1) && !(k === 'sort' && v === 'new') ? v : null;
    this.router.navigate([], { queryParams: qp });
  }

  search(q: string) {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.set({ q }), 300);
  }

  load() {
    const f = this.f();
    this.api.get<Paged<AdminProductRow>>('/products', { ...f, status: f.status || undefined, limit: 30 }).subscribe({
      next: (r) => {
        this.data.set(r);
        this.selected.set(new Set());
      },
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }

  toggle(id: number) {
    const s = new Set(this.selected());
    if (s.has(id)) s.delete(id);
    else s.add(id);
    this.selected.set(s);
  }

  toggleAll() {
    this.selected.set(this.allSelected() ? new Set() : new Set((this.data()?.items ?? []).map((p) => p.id)));
  }

  async bulk(action: 'activate' | 'deactivate' | 'delete' | 'feature' | 'unfeature') {
    const ids = [...this.selected()];
    if (action === 'delete' && !(await this.confirm.ask(`Видалити ${ids.length} товар(ів)? Історія замовлень збережеться.`, { confirmLabel: 'Видалити', danger: true }))) return;
    this.api.post('/products/bulk', { ids, action }).subscribe({
      next: () => {
        this.toasts.success('Готово');
        this.load();
      },
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }

  duplicate(p: AdminProductRow) {
    this.api.post<{ id: number }>(`/products/${p.id}/duplicate`).subscribe({
      next: (r) => {
        this.toasts.success('Копію створено (прихована)');
        this.router.navigate(['/admin/products', r.id]);
      },
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }
}
