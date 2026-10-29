import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { Subscription, catchError, of } from 'rxjs';
import type { CategoryDetail, ProductCard, ProductListResponse, ProductQuery } from '../../../core/models';
import { Store } from '../../../core/store.service';
import { storage } from '../../../core/storage';
import { Icon } from '../../../shared/icon';
import { ProductCardView } from '../../../shared/product-card';

const PAGE_SIZE = 24;
type Sort = NonNullable<ProductQuery['sort']>;

@Component({
  selector: 'app-catalog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, Icon, ProductCardView],
  template: `
    <section class="container top">
      <nav class="crumbs small">
        <a routerLink="/">Головна</a><span>/</span>
        @if (slug()) {
          <a routerLink="/catalog">Каталог</a>
          @for (b of crumbs(); track b.slug; let last = $last) {
            <span>/</span>
            @if (last) { <span class="cur">{{ b.name }}</span> } @else { <a [routerLink]="['/catalog', b.slug]">{{ b.name }}</a> }
          }
        } @else {
          <span class="cur">Каталог</span>
        }
      </nav>
      <h1 class="h1">{{ heading() }}</h1>
      @if (category()?.description) { <p class="desc muted">{{ category()!.description }}</p> }

      @if (subcats().length) {
        <div class="subcats">
          @for (c of subcats(); track c.slug) {
            <a class="chip" [routerLink]="['/catalog', c.slug]" [queryParams]="keepParams()" [class.active]="c.slug === slug()">{{ c.name }}</a>
          }
        </div>
      }
    </section>

    <div class="container toolbar-wrap">
      <div class="toolbar">
        <button class="btn btn-outline btn-sm filter-btn" (click)="sheet.set(true)">
          <app-icon name="filter" [size]="16" /> Фільтри @if (activeCount()) { <span class="count">{{ activeCount() }}</span> }
        </button>
        <span class="total small muted">{{ total() }} {{ plural(total()) }}</span>
        <span class="spacer"></span>
        <div class="density">
          @for (d of [2, 3, 4]; track d) {
            <button [class.on]="density() === d" (click)="setDensity(d)" [attr.aria-label]="d + ' колонки'">
              @for (x of cols(d); track x) { <i></i> }
            </button>
          }
        </div>
        <label class="sort">
          <span class="visually-hidden">Сортування</span>
          <select class="select" [ngModel]="sort()" (ngModelChange)="patch({ sort: $event === 'new' ? null : $event })">
            <option value="new">Новинки</option>
            <option value="popular">Популярні</option>
            <option value="price_asc">Ціна: за зростанням</option>
            <option value="price_desc">Ціна: за спаданням</option>
            <option value="name">За назвою</option>
          </select>
        </label>
      </div>
      @if (activeChips().length) {
        <div class="active-chips">
          @for (c of activeChips(); track c.label) {
            <button class="chip" (click)="patch(c.clear)">{{ c.label }} <app-icon name="close" [size]="12" /></button>
          }
          <button class="clear-all link small" (click)="clearAll()">Очистити все</button>
        </div>
      }
    </div>

    <div class="container layout">
      <!-- FILTERS -->
      <aside class="filters" [class.open]="sheet()">
        <div class="sheet-head">
          <span class="h3">Фільтри</span>
          <button class="icon-btn" (click)="sheet.set(false)" aria-label="Закрити"><app-icon name="close" /></button>
        </div>
        <div class="sheet-body">
          @if (q()) {
            <div class="group">
              <span class="label">Пошук</span>
              <button class="chip active" (click)="patch({ q: null })">«{{ q() }}» <app-icon name="close" [size]="12" /></button>
            </div>
          }
          @if (facets().sizes.length) {
            <div class="group">
              <span class="label">Розмір</span>
              <div class="sizes">
                @for (s of facets().sizes; track s) {
                  <button class="size" [class.active]="selectedSizes().includes(s)" (click)="toggleList('sizes', s)">{{ s }}</button>
                }
              </div>
            </div>
          }
          @if (facets().colors.length) {
            <div class="group">
              <span class="label">Колір</span>
              <div class="colors">
                @for (c of facets().colors; track c.name) {
                  <button class="color" [class.active]="selectedColors().includes(c.name)" (click)="toggleList('colors', c.name)">
                    <span class="sw" [style.background]="c.hex || '#ccc'"></span>{{ c.name }}
                  </button>
                }
              </div>
            </div>
          }
          <div class="group">
            <span class="label">Ціна, ₴</span>
            <div class="price-row">
              <input class="input" type="number" inputmode="numeric" [placeholder]="'від ' + (facets().price.min || 0)" [ngModel]="minPrice()" (change)="setPrice('minPrice', $event)" />
              <span class="muted">—</span>
              <input class="input" type="number" inputmode="numeric" [placeholder]="'до ' + (facets().price.max || 0)" [ngModel]="maxPrice()" (change)="setPrice('maxPrice', $event)" />
            </div>
          </div>
          <div class="group toggles">
            <label class="checkbox"><input type="checkbox" [checked]="flag('inStock')" (change)="toggleFlag('inStock')" /> Лише в наявності</label>
            <label class="checkbox"><input type="checkbox" [checked]="flag('sale')" (change)="toggleFlag('sale')" /> Зі знижкою</label>
            <label class="checkbox"><input type="checkbox" [checked]="flag('new')" (change)="toggleFlag('new')" /> Новинки</label>
          </div>
        </div>
        <div class="sheet-foot">
          <button class="btn btn-outline" (click)="clearAll()">Скинути</button>
          <button class="btn" (click)="sheet.set(false)">Показати {{ total() }}</button>
        </div>
      </aside>
      @if (sheet()) { <div class="backdrop" (click)="sheet.set(false)"></div> }

      <!-- RESULTS -->
      <div class="results">
        @if (loading() && !items().length) {
          <div class="grid" [attr.data-d]="density()">
            @for (i of skeletons; track i) {
              <div><div class="skeleton sk-img"></div><div class="skeleton sk-line"></div><div class="skeleton sk-line short"></div></div>
            }
          </div>
        } @else if (!items().length) {
          <div class="empty-state">
            <app-icon name="search" [size]="36" />
            <p class="h3">Нічого не знайдено</p>
            <p>Спробуйте змінити фільтри або пошуковий запит.</p>
            <button class="btn btn-outline" (click)="clearAll()">Скинути фільтри</button>
          </div>
        } @else {
          <div class="grid" [attr.data-d]="density()" [class.dim]="loading()">
            @for (p of items(); track p.id) {
              <app-product-card class="fade-in" [product]="p" />
            }
          </div>
          <div class="more">
            <p class="small muted">Показано {{ items().length }} з {{ total() }}</p>
            <div class="progress"><span [style.width.%]="(items().length / (total() || 1)) * 100"></span></div>
            @if (items().length < total()) {
              <button class="btn btn-outline" (click)="loadMore()" [disabled]="loadingMore()">
                @if (loadingMore()) { <span class="spinner"></span> } Показати ще
              </button>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .top { padding-top: 28px; padding-bottom: 8px; }
    .crumbs { display: flex; flex-wrap: wrap; gap: 8px; color: var(--muted); margin-bottom: 18px; }
    .crumbs a:hover { color: var(--ink); }
    .crumbs .cur { color: var(--ink); }
    .desc { max-width: 640px; margin: 12px 0 0; }
    .subcats { display: flex; gap: 8px; overflow-x: auto; padding: 22px 0 4px; scrollbar-width: none; }
    .subcats .chip { flex-shrink: 0; }
    .toolbar-wrap { position: sticky; top: var(--header-h); z-index: 5; background: var(--bg); padding-top: 14px; padding-bottom: 10px; border-bottom: 1px solid var(--line); margin-bottom: 24px; }
    .toolbar { display: flex; align-items: center; gap: 14px; }
    .filter-btn .count { background: var(--ink); color: var(--bg); border-radius: 999px; min-width: 18px; height: 18px; display: inline-grid; place-items: center; font-size: 10px; letter-spacing: 0; padding: 0 5px; }
    .filter-btn:hover .count { background: var(--bg); color: var(--ink); }
    .sort .select { min-height: 38px; padding: 6px 34px 6px 12px; font-size: 13px; border-color: var(--line); background-color: transparent; }
    .density { display: none; gap: 4px; }
    .density button { display: flex; gap: 2px; padding: 8px 6px; background: none; border: 0; opacity: .35; transition: opacity .2s; }
    .density button.on, .density button:hover { opacity: 1; }
    .density i { width: 4px; height: 14px; background: var(--ink); display: block; }
    @media (min-width: 900px) { .density { display: flex; } }
    @media (max-width: 599px) { .total { display: none; } }
    .active-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding-top: 10px; }
    .active-chips .chip { min-height: 30px; font-size: 12px; }
    .clear-all { background: none; border: 0; padding: 0 6px; color: var(--muted); }

    .layout { display: grid; gap: 32px; padding-bottom: 80px; }
    @media (min-width: 1200px) { .layout { grid-template-columns: 240px 1fr; } .filter-btn { display: none; } }

    .filters { display: flex; flex-direction: column; }
    .sheet-head, .sheet-foot { display: none; }
    .group { padding: 18px 0; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 12px; }
    .group:first-child { padding-top: 0; }
    .sizes { display: flex; flex-wrap: wrap; gap: 6px; }
    .size { min-width: 44px; height: 38px; border: 1px solid var(--line-strong); background: var(--surface); font-size: 13px; transition: all .2s; }
    .size:hover { border-color: var(--ink); }
    .size.active { background: var(--ink); color: var(--bg); border-color: var(--ink); }
    .colors { display: flex; flex-direction: column; gap: 4px; }
    .color { display: flex; align-items: center; gap: 10px; background: none; border: 0; padding: 5px 0; font-size: 14px; text-align: left; color: var(--ink-2); }
    .color .sw { width: 18px; height: 18px; border-radius: 50%; border: 1px solid rgba(0,0,0,.12); box-shadow: 0 0 0 2px var(--bg), 0 0 0 3px transparent; transition: box-shadow .2s; }
    .color.active { color: var(--ink); font-weight: 600; }
    .color.active .sw { box-shadow: 0 0 0 2px var(--bg), 0 0 0 3px var(--ink); }
    .price-row { display: flex; align-items: center; gap: 8px; }
    .price-row .input { min-height: 42px; padding: 8px 10px; }
    .toggles { gap: 10px; font-size: 14px; }

    @media (max-width: 1199px) {
      .filters { position: fixed; z-index: 60; top: 0; bottom: 0; left: 0; width: min(380px, 88vw); background: var(--bg); transform: translateX(-100%); transition: transform .4s var(--ease); box-shadow: var(--shadow-lg); }
      .filters.open { transform: none; }
      .sheet-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--line); }
      .sheet-body { flex: 1; overflow-y: auto; padding: 20px; }
      .sheet-foot { display: grid; grid-template-columns: 1fr 1.4fr; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--line); }
      .backdrop { position: fixed; inset: 0; z-index: 55; background: rgba(31,29,26,.35); animation: fade .3s; }
    }
    @keyframes fade { from { opacity: 0; } }

    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28px 12px; transition: opacity .25s; }
    .grid.dim { opacity: .5; }
    @media (min-width: 900px) {
      .grid { gap: 44px 20px; }
      .grid[data-d='3'] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .grid[data-d='4'] { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    }
    .fade-in { animation: up .6s var(--ease) both; }
    @keyframes up { from { opacity: 0; transform: translateY(16px); } }
    .sk-img { aspect-ratio: 3 / 4; }
    .sk-line { height: 13px; margin-top: 12px; width: 75%; }
    .sk-line.short { width: 40%; margin-top: 8px; }
    .more { display: flex; flex-direction: column; align-items: center; gap: 14px; padding-top: 56px; }
    .more p { margin: 0; }
    .progress { width: 200px; height: 2px; background: var(--line); }
    .progress span { display: block; height: 100%; background: var(--ink); transition: width .5s var(--ease); }
    .empty-state app-icon { margin: 0 auto 16px; }
  `,
})
export class CatalogPage {
  readonly slug = input<string>();

  private store = inject(Store);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private title = inject(Title);

  private query = toSignal(this.route.queryParams, { initialValue: {} as Params });

  protected items = signal<ProductCard[]>([]);
  protected total = signal(0);
  protected facets = signal<ProductListResponse['facets']>({ sizes: [], colors: [], price: { min: 0, max: 0 } });
  protected loading = signal(true);
  protected loadingMore = signal(false);
  protected category = signal<CategoryDetail | null>(null);
  protected sheet = signal(false);
  protected density = signal<number>(storage.get('amina.density', 4));
  protected skeletons = Array.from({ length: 8 }, (_, i) => i);

  protected q = computed(() => (this.query()['q'] as string) || '');
  protected sort = computed(() => ((this.query()['sort'] as Sort) || 'new'));
  protected selectedSizes = computed(() => this.listParam('sizes'));
  protected selectedColors = computed(() => this.listParam('colors'));
  protected minPrice = computed(() => this.query()['minPrice'] ?? null);
  protected maxPrice = computed(() => this.query()['maxPrice'] ?? null);

  protected crumbs = computed(() => this.category()?.breadcrumbs ?? []);
  protected heading = computed(() => {
    if (this.slug()) return this.category()?.name ?? ' ';
    if (this.q()) return `Пошук: «${this.q()}»`;
    if (this.flag('sale')) return 'Розпродаж';
    if (this.flag('new')) return 'Новинки';
    return 'Каталог';
  });

  /** Children of the current category; for a leaf category, its siblings. */
  protected subcats = computed(() => {
    const slug = this.slug();
    const tree = this.store.categories();
    if (!slug) return tree.map((c) => ({ name: c.name, slug: c.slug }));
    const cat = this.store.findCategory(slug);
    if (!cat) return [];
    if (cat.children.length) return cat.children.map((c) => ({ name: c.name, slug: c.slug }));
    const parent = cat.parent_id ? this.findById(cat.parent_id) : null;
    return parent ? parent.children.map((c) => ({ name: c.name, slug: c.slug })) : [];
  });

  protected activeChips = computed(() => {
    const chips: { label: string; clear: Params }[] = [];
    for (const s of this.selectedSizes()) chips.push({ label: `Розмір ${s}`, clear: { sizes: this.without('sizes', s) } });
    for (const c of this.selectedColors()) chips.push({ label: c, clear: { colors: this.without('colors', c) } });
    if (this.minPrice()) chips.push({ label: `від ${this.minPrice()} ₴`, clear: { minPrice: null } });
    if (this.maxPrice()) chips.push({ label: `до ${this.maxPrice()} ₴`, clear: { maxPrice: null } });
    if (this.flag('inStock')) chips.push({ label: 'В наявності', clear: { inStock: null } });
    if (this.flag('sale') && this.slug()) chips.push({ label: 'Зі знижкою', clear: { sale: null } });
    if (this.flag('new') && this.slug()) chips.push({ label: 'Новинки', clear: { new: null } });
    return chips;
  });
  protected activeCount = computed(() => this.activeChips().length);

  private loadedPage = 0;
  private lastKey = '';
  private sub?: Subscription;
  private catSub?: Subscription;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.sub?.unsubscribe();
      this.catSub?.unsubscribe();
      document.body.style.overflow = '';
    });

    effect(() => {
      const slug = this.slug();
      this.category.set(null);
      this.catSub?.unsubscribe();
      if (!slug) return;
      this.catSub = this.store.category(slug).pipe(catchError(() => of(null))).subscribe((c) => {
        this.category.set(c);
        this.title.setTitle(`${c?.name ?? 'Каталог'} — Amina`);
      });
    });

    effect(() => {
      const params = this.query();
      const slug = this.slug();
      const page = Math.max(1, Number(params['page'] ?? 1) || 1);
      const { page: _p, ...rest } = params;
      const key = JSON.stringify({ slug, rest });
      if (key === this.lastKey && page === this.loadedPage + 1 && this.loadedPage > 0) {
        this.fetch(page, PAGE_SIZE, true);
      } else if (key !== this.lastKey || page !== this.loadedPage) {
        this.lastKey = key;
        // Fresh load restores up to two pages in one request (API limit is 60)
        const restore = Math.min(page, 2);
        this.fetch(1, PAGE_SIZE * restore, false, restore);
        if (page > restore) queueMicrotask(() => this.patch({ page: restore }, true));
      }
    });

    effect(() => {
      document.body.style.overflow = this.sheet() && window.innerWidth < 1200 ? 'hidden' : '';
    });

    effect(() => {
      if (!this.slug()) this.title.setTitle(`${this.heading()} — Amina`);
    });
  }

  private fetch(page: number, limit: number, append: boolean, asPage = page) {
    this.sub?.unsubscribe();
    if (append) this.loadingMore.set(true);
    else this.loading.set(true);
    const p = this.query();
    const q: ProductQuery = {
      category: this.slug() || undefined,
      q: (p['q'] as string) || undefined,
      sizes: (p['sizes'] as string) || undefined,
      colors: (p['colors'] as string) || undefined,
      minPrice: p['minPrice'] ? Number(p['minPrice']) : undefined,
      maxPrice: p['maxPrice'] ? Number(p['maxPrice']) : undefined,
      sale: p['sale'] ? '1' : undefined,
      new: p['new'] ? '1' : undefined,
      inStock: p['inStock'] ? '1' : undefined,
      sort: (p['sort'] as Sort) || 'new',
      page,
      limit: Math.min(limit, 60),
    };
    this.sub = this.store.products(q).subscribe({
      next: (res) => {
        this.items.set(append ? [...this.items(), ...res.items] : res.items);
        this.total.set(res.total);
        this.facets.set(res.facets);
        this.loadedPage = asPage;
        this.loading.set(false);
        this.loadingMore.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadingMore.set(false);
      },
    });
  }

  loadMore() {
    this.patch({ page: this.loadedPage + 1 }, true);
  }

  patch(params: Params, keepPage = false) {
    const next: Params = { ...params };
    if (!keepPage) next['page'] = null;
    this.router.navigate([], { queryParams: next, queryParamsHandling: 'merge', replaceUrl: true });
  }

  clearAll() {
    const keep: Params = {};
    if (this.q()) keep['q'] = this.q();
    if (!this.slug()) {
      if (this.flag('sale')) keep['sale'] = 1;
      if (this.flag('new')) keep['new'] = 1;
    }
    this.router.navigate([], { queryParams: keep, replaceUrl: true });
  }

  keepParams(): Params {
    const { page: _p, sizes: _s, colors: _c, ...rest } = this.query();
    return rest;
  }

  flag(name: string): boolean {
    return !!this.query()[name];
  }
  toggleFlag(name: string) {
    this.patch({ [name]: this.flag(name) ? null : 1 });
  }

  toggleList(name: 'sizes' | 'colors', value: string) {
    const list = this.listParam(name);
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    this.patch({ [name]: next.length ? next.join(',') : null });
  }

  setPrice(name: 'minPrice' | 'maxPrice', e: Event) {
    const v = (e.target as HTMLInputElement).value;
    this.patch({ [name]: v && Number(v) >= 0 ? Math.round(Number(v)) : null });
  }

  setDensity(d: number) {
    this.density.set(d);
    storage.set('amina.density', d);
  }

  cols(n: number) {
    return Array.from({ length: n }, (_, i) => i);
  }

  plural(n: number) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'товар';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'товари';
    return 'товарів';
  }

  private listParam(name: string): string[] {
    const v = this.query()[name] as string | undefined;
    return v ? v.split(',').filter(Boolean) : [];
  }
  private without(name: string, value: string): string | null {
    const next = this.listParam(name).filter((v) => v !== value);
    return next.length ? next.join(',') : null;
  }
  private findById(id: number, list = this.store.categories()): ReturnType<Store['findCategory']> {
    for (const c of list) {
      if (c.id === id) return c;
      const f = this.findById(id, c.children);
      if (f) return f;
    }
    return null;
  }
}
