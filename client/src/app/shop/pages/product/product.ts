import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { Analytics } from '../../../core/analytics.service';
import { Cart } from '../../../core/cart.service';
import { preorderWhen } from '../../../core/labels';
import type { ProductCard, ProductDetail, ProductVariant } from '../../../core/models';
import { storage } from '../../../core/storage';
import { Store } from '../../../core/store.service';
import { Toasts } from '../../../core/toast.service';
import { Wishlist } from '../../../core/wishlist.service';
import { Icon } from '../../../shared/icon';
import { ProductCardView } from '../../../shared/product-card';
import { UahPipe } from '../../../shared/uah.pipe';
import { StockAlertDialog } from './stock-alert';
import { ProductReviews } from './product-reviews';
import { Stars } from '../../../shared/stars';

const SIZE_GUIDE = [
  ['XS', '40–42', '80–84', '62–66', '88–92'],
  ['S', '42–44', '84–88', '66–70', '92–96'],
  ['M', '44–46', '88–92', '70–74', '96–100'],
  ['L', '46–48', '92–96', '74–78', '100–104'],
  ['XL', '48–50', '96–100', '78–82', '104–108'],
];

/** Units that can be bought now, or pre-ordered when the variant is sold out. */
function available(v: ProductVariant | null | undefined): number {
  if (!v) return 0;
  return v.stock > 0 ? v.stock : (v.preorder ?? 0);
}

@Component({
  selector: 'app-product',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, ProductCardView, UahPipe, StockAlertDialog, ProductReviews, Stars],
  template: `
    @if (error()) {
      <div class="container empty-state">
        <p class="h2">Товар не знайдено</p>
        <p>Можливо, його вже розпродано або посилання застаріло.</p>
        <a class="btn" routerLink="/catalog">До каталогу</a>
      </div>
    } @else if (!p()) {
      <div class="container pdp">
        <div class="skeleton" style="aspect-ratio: 3/4"></div>
        <div class="stack"><div class="skeleton" style="height: 40px; width: 70%"></div><div class="skeleton" style="height: 20px; width: 30%"></div><div class="skeleton" style="height: 200px"></div></div>
      </div>
    } @else {
      @let prod = p()!;
      <nav class="container crumbs small">
        <a routerLink="/">Головна</a><span>/</span><a routerLink="/catalog">Каталог</a>
        @for (b of prod.breadcrumbs; track b.slug) { <span>/</span><a [routerLink]="['/catalog', b.slug]">{{ b.name }}</a> }
      </nav>

      <div class="container pdp">
        <!-- GALLERY -->
        <div class="gallery">
          <div class="thumbs">
            @for (img of images(); track img.url; let i = $index) {
              <button class="thumb" [class.on]="i === active()" (click)="active.set(i)"><img [src]="img.url" [alt]="img.alt || prod.name" /></button>
            }
          </div>
          <div class="main" (touchstart)="tStart($event)" (touchend)="tEnd($event)">
            @for (img of images(); track img.url; let i = $index) {
              <div class="frame" [class.on]="i === active()" (mousemove)="zoomMove($event)" (mouseleave)="zoom.set(null)" (click)="lightbox.set(true)">
                <img [src]="img.url" [alt]="img.alt || prod.name" [style.transform-origin]="zoom() ?? 'center'" [class.zoomed]="!!zoom() && i === active()" />
              </div>
            }
            @if (images().length > 1) {
              <button class="nav prev" (click)="step(-1)" aria-label="Попереднє фото"><app-icon name="chevron-left" /></button>
              <button class="nav next" (click)="step(1)" aria-label="Наступне фото"><app-icon name="chevron-right" /></button>
              <div class="pager">
                @for (img of images(); track img.url; let i = $index) { <span [class.on]="i === active()"></span> }
              </div>
            }
            <div class="tags">
              @if (discount() > 0) { <span class="tag tag-sale">−{{ discount() }}%</span> }
              @if (prod.is_new) { <span class="tag">New</span> }
            </div>
          </div>
        </div>

        <!-- INFO -->
        <div class="info">
          <div class="info-inner">
            @if (prod.category_name) { <span class="eyebrow">{{ prod.category_name }}</span> }
            <h1 class="h1 name">{{ prod.name }}</h1>
            @if (prod.rating_count) {
              <a class="rating" href="#reviews" (click)="toReviews($event)"><app-stars [value]="prod.rating_avg ?? 0" /> <span class="small">{{ prod.rating_avg }} · {{ prod.rating_count }} відг.</span></a>
            }
            <div class="price-line">
              <span class="price big" [class.price-sale]="discount() > 0">{{ price() | uah }}</span>
              @if (discount() > 0) { <span class="price-old">{{ prod.old_price | uah }}</span> }
            </div>

            @if (colors().length) {
              <div class="opt">
                <div class="opt-head"><span class="label">Колір</span><span class="small">{{ color() }}</span></div>
                <div class="swatches">
                  @for (c of colors(); track c.name) {
                    <button class="swatch" [class.on]="c.name === color()" [style.--c]="c.hex || '#ccc'" (click)="selectColor(c.name)" [title]="c.name" [attr.aria-label]="c.name"></button>
                  }
                </div>
              </div>
            }

            @if (sizes().length) {
              <div class="opt">
                <div class="opt-head">
                  <span class="label">Розмір</span>
                  <button class="link small guide-btn" (click)="guide.set(true)"><app-icon name="ruler" [size]="16" /> Таблиця розмірів</button>
                </div>
                <div class="sizes" [class.shake]="shake()">
                  @for (s of sizes(); track s.size) {
                    <button class="size" [class.on]="s.size === size()" [class.out]="!s.stock && !s.pre && !s.inc" [class.pre]="!s.stock && s.pre > 0" [class.soon]="!s.stock && !s.pre && s.inc"
                      [disabled]="!s.stock && !s.pre && !s.inc" (click)="size.set(s.size)"
                      [attr.title]="!s.stock ? (s.pre ? 'Передзамовлення' : s.inc ? 'В дорозі' : null) : null">{{ s.size }}</button>
                  }
                </div>
                @if (variant(); as v) {
                  @if (v.stock > 0 && v.stock <= 3) { <p class="low small"><span class="pulse"></span>Залишилось {{ v.stock }} шт.</p> }
                }
                @if (inStock() && hasMissingSizes()) {
                  <button class="link small notify-btn" (click)="alertOpen.set(true)"><app-icon name="bell" [size]="15" /> Немає вашого розміру? Повідомимо про наявність</button>
                }
              </div>
            }

            @if (preorderNote(); as note) {
              <div class="preorder-note">
                <app-icon name="parcel" [size]="20" />
                <div><b>Передзамовлення</b><span class="small">{{ note }}</span></div>
              </div>
            } @else if (incomingNote(); as note) {
              <div class="preorder-note soon-note">
                <app-icon name="truck" [size]="20" />
                <div><b>В дорозі</b><span class="small">{{ note }}</span></div>
              </div>
            }

            <div class="buy">
              <div class="qty">
                <button (click)="qty.set(Math.max(1, qty() - 1))" aria-label="Менше"><app-icon name="minus" [size]="16" /></button>
                <span>{{ qty() }}</span>
                <button (click)="qty.set(Math.min(maxQty(), qty() + 1))" aria-label="Більше"><app-icon name="plus" [size]="16" /></button>
              </div>
              @if (inStock() && !isIncoming()) {
                <button class="btn add" (click)="addToCart()"><app-icon [name]="isPreorder() ? 'parcel' : 'bag'" [size]="18" /> {{ isPreorder() ? 'Передзамовити' : 'Додати в кошик' }}</button>
              } @else {
                <button class="btn add" (click)="alertOpen.set(true)"><app-icon name="bell" [size]="18" /> {{ isIncoming() || onlyIncoming() ? 'Повідомити, коли надійде' : 'Повідомити про наявність' }}</button>
              }
              <button class="btn btn-outline wish" [class.on]="wished()" (click)="toggleWish()" [attr.aria-label]="wished() ? 'Прибрати з обраного' : 'В обране'">
                <app-icon [name]="wished() ? 'heart-fill' : 'heart'" [size]="18" />
              </button>
            </div>

            <ul class="perks small">
              <li><app-icon name="truck" [size]="18" /> {{ isPreorder() ? 'Відправимо одразу, щойно товар надійде' : 'Відправка протягом 1–2 днів' }}</li>
              <li><app-icon name="refresh" [size]="18" /> Обмін і повернення 14 днів</li>
              <li><app-icon name="qr" [size]="18" /> Оплата Monobank QR, карткою або при отриманні</li>
            </ul>

            <div class="acc">
              @for (s of sections(); track s.title; let i = $index) {
                <div class="acc-item" [class.open]="openSection() === i">
                  <button class="acc-head" (click)="openSection.set(openSection() === i ? -1 : i)">
                    {{ s.title }} <app-icon name="plus" [size]="16" />
                  </button>
                  <div class="acc-body"><div><p>{{ s.body }}</p></div></div>
                </div>
              }
            </div>
            @if (prod.sku) { <p class="tiny muted sku">Артикул: {{ variant()?.sku || prod.sku }}</p> }
          </div>
        </div>
      </div>

      <div class="container"><app-product-reviews [product]="prod" /></div>

      @if (prod.related.length) {
        <section class="container related">
          <h2 class="h2">Вам також сподобається</h2>
          <div class="rail">
            @for (r of prod.related; track r.id) { <app-product-card [product]="r" /> }
          </div>
        </section>
      }
      @if (recent().length) {
        <section class="container related">
          <h2 class="h3">Ви переглядали</h2>
          <div class="rail small-rail">
            @for (r of recent(); track r.id) { <app-product-card [product]="r" /> }
          </div>
        </section>
      }

      <!-- sticky mobile bar -->
      <div class="sticky-bar">
        <div><div class="small">{{ prod.name }}</div><b>{{ price() | uah }}</b>@if (size()) { <span class="muted small"> · {{ size() }}</span> }</div>
        @if (inStock() && !isIncoming()) {
          <button class="btn btn-sm" (click)="addToCart()">{{ isPreorder() ? 'Передзамовити' : 'В кошик' }}</button>
        } @else {
          <button class="btn btn-sm" (click)="alertOpen.set(true)">Повідомити</button>
        }
      </div>

      @if (lightbox()) {
        <div class="lightbox" (click)="lightbox.set(false)">
          <button class="icon-btn lb-close" aria-label="Закрити"><app-icon name="close" /></button>
          <img [src]="images()[active()]?.url" [alt]="prod.name" (click)="$event.stopPropagation()" />
          @if (images().length > 1) {
            <button class="nav prev" (click)="$event.stopPropagation(); step(-1)"><app-icon name="chevron-left" /></button>
            <button class="nav next" (click)="$event.stopPropagation(); step(1)"><app-icon name="chevron-right" /></button>
          }
        </div>
      }

      @if (alertOpen() && p(); as prod) {
        <app-stock-alert [product]="prod" [color]="color()" [size]="size()" (close)="alertOpen.set(false)" />
      }

      @if (guide()) {
        <div class="modal-wrap" (click)="guide.set(false)">
          <div class="modal" (click)="$event.stopPropagation()">
            <div class="modal-head"><span class="h3">Таблиця розмірів</span><button class="icon-btn" (click)="guide.set(false)"><app-icon name="close" /></button></div>
            <table class="guide">
              <thead><tr><th>Розмір</th><th>UA</th><th>Груди, см</th><th>Талія, см</th><th>Стегна, см</th></tr></thead>
              <tbody>
                @for (r of guideRows; track r[0]) { <tr [class.hl]="r[0] === size()">@for (c of r; track $index) { <td>{{ c }}</td> }</tr> }
              </tbody>
            </table>
            <p class="small muted">Не впевнені з розміром? Напишіть нам у чат — підкажемо за вашими параметрами.</p>
          </div>
        </div>
      }
    }
  `,
  styleUrl: './product.scss',
})
export class ProductPage {
  readonly slug = input.required<string>();
  protected readonly Math = Math;
  protected guideRows = SIZE_GUIDE;

  private store = inject(Store);
  private cart = inject(Cart);
  private wishlist = inject(Wishlist);
  private toasts = inject(Toasts);
  private title = inject(Title);
  private analytics = inject(Analytics);

  protected p = signal<ProductDetail | null>(null);
  protected error = signal(false);
  protected active = signal(0);
  protected color = signal('');
  protected size = signal('');
  protected qty = signal(1);
  protected zoom = signal<string | null>(null);
  protected lightbox = signal(false);
  protected guide = signal(false);
  protected alertOpen = signal(false);
  protected shake = signal(false);
  protected openSection = signal(0);
  protected recent = signal<ProductCard[]>([]);
  private sub?: Subscription;
  private touchX = 0;

  protected colors = computed(() => {
    const seen = new Map<string, string | null>();
    for (const v of this.p()?.variants ?? []) if (v.color && !seen.has(v.color)) seen.set(v.color, v.color_hex);
    return [...seen].map(([name, hex]) => ({ name, hex }));
  });
  protected sizes = computed(() => {
    const out = new Map<string, { stock: number; pre: number; inc: boolean }>();
    for (const v of this.p()?.variants ?? []) {
      if (!v.size || (this.color() && v.color !== this.color())) continue;
      const cur = out.get(v.size) ?? { stock: 0, pre: 0, inc: false };
      out.set(v.size, { stock: cur.stock + v.stock, pre: cur.pre + (v.preorder ?? 0), inc: cur.inc || Boolean(v.incoming) });
    }
    return [...out].map(([size, a]) => ({ size, ...a }));
  });
  protected variant = computed<ProductVariant | null>(() => {
    const vs = this.p()?.variants ?? [];
    return (
      vs.find((v) => (!this.color() || v.color === this.color()) && (!this.sizes().length || v.size === this.size())) ?? null
    );
  });
  protected images = computed(() => {
    const all = this.p()?.images ?? [];
    const byColor = all.filter((i) => i.color && i.color === this.color());
    return byColor.length ? [...byColor, ...all.filter((i) => !i.color)] : all;
  });
  protected price = computed(() => this.variant()?.price ?? this.p()?.price ?? 0);
  protected discount = computed(() => {
    const p = this.p();
    return p?.old_price && p.old_price > this.price() ? Math.round((1 - this.price() / p.old_price) * 100) : 0;
  });
  /** Some size of the selected colour is sold out — offer a back-in-stock alert. */
  toReviews(e: Event) {
    e.preventDefault();
    document.getElementById('reviews')?.scrollIntoView({ behavior: 'smooth' });
  }

  protected hasMissingSizes = computed(() => this.sizes().some((s) => !s.stock && !s.pre && !s.inc));
  /** the chosen size is on the way, but can't be bought yet */
  protected isIncoming = computed(() => {
    const v = this.variant();
    return Boolean(v && (!this.sizes().length || this.size()) && available(v) <= 0 && v.incoming);
  });
  protected onlyIncoming = computed(() => {
    const vs = this.p()?.variants ?? [];
    return !vs.some((v) => available(v) > 0) && vs.some((v) => v.incoming);
  });
  protected incomingNote = computed(() => {
    const v = this.variant();
    if (this.isIncoming() && v) {
      return `${v.size ? `Розмір ${v.size} уже` : 'Товар уже'} в дорозі, ${preorderWhen(v.incoming_eta)}. Залиште контакт — повідомимо, щойно надійде.`;
    }
    if (this.onlyIncoming()) {
      const eta = (this.p()?.variants ?? []).map((x) => x.incoming_eta).filter(Boolean).sort()[0];
      return `Нова партія вже в дорозі, ${preorderWhen(eta)}. Натисніть «Повідомити, коли надійде» — напишемо першим.`;
    }
    return null;
  });
  /** can be bought now or pre-ordered */
  protected inStock = computed(() => (this.p()?.variants ?? []).some((v) => available(v) > 0));
  private onlyPreorder = computed(() => {
    const vs = this.p()?.variants ?? [];
    return !vs.some((v) => v.stock > 0) && vs.some((v) => (v.preorder ?? 0) > 0);
  });
  protected isPreorder = computed(() => {
    const v = this.variant();
    return v && (!this.sizes().length || this.size()) ? v.stock <= 0 && (v.preorder ?? 0) > 0 : this.onlyPreorder();
  });
  protected preorderNote = computed(() => {
    const v = this.variant();
    if (v && v.stock <= 0 && (v.preorder ?? 0) > 0 && (!this.sizes().length || this.size())) {
      return `${v.size ? `Розмір ${v.size} уже в дорозі` : 'Товар уже в дорозі'}, ${preorderWhen(v.preorder_eta)}. Оформіть замовлення зараз — відправимо одразу після надходження.`;
    }
    if (this.onlyPreorder()) {
      const eta = (this.p()?.variants ?? []).map((x) => x.preorder_eta).filter(Boolean).sort()[0];
      return `Нова партія вже в дорозі, ${preorderWhen(eta)}. Можна замовити наперед.`;
    }
    return null;
  });
  protected maxQty = computed(() => Math.max(1, available(this.variant())));
  protected wished = computed(() => {
    const p = this.p();
    return p ? this.wishlist.has(p.id) : false;
  });
  protected sections = computed(() => {
    const p = this.p();
    if (!p) return [];
    return [
      { title: 'Опис', body: p.description || 'Опис з’явиться найближчим часом.' },
      { title: 'Склад і догляд', body: [p.composition, p.care].filter(Boolean).join('\n\n') || 'Інформація уточнюється.' },
      { title: 'Доставка й оплата', body: 'Відправляємо Новою поштою протягом 1–2 робочих днів. Оплата через Monobank (QR-код), карткою онлайн, переказом на IBAN або накладеним платежем при отриманні.' },
      { title: 'Повернення', body: 'Обмін і повернення протягом 14 днів з моменту отримання, якщо річ не була у використанні та збережені бірки.' },
    ];
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.sub?.unsubscribe();
      document.body.style.overflow = '';
      removeEventListener('keydown', this.onKey);
    });
    addEventListener('keydown', this.onKey);

    effect(() => {
      const slug = this.slug();
      this.sub?.unsubscribe();
      this.p.set(null);
      this.error.set(false);
      this.sub = this.store.product(slug).subscribe({
        next: (p) => this.init(p),
        error: () => this.error.set(true),
      });
    });
    effect(() => {
      document.body.style.overflow = this.lightbox() || this.guide() ? 'hidden' : '';
    });
    effect(() => {
      // keep quantity inside stock when switching size/colour
      if (this.qty() > this.maxQty()) this.qty.set(this.maxQty());
    });
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this.lightbox.set(false);
      this.guide.set(false);
    }
    if (this.lightbox() && e.key === 'ArrowRight') this.step(1);
    if (this.lightbox() && e.key === 'ArrowLeft') this.step(-1);
  };

  private init(p: ProductDetail) {
    this.p.set(p);
    this.title.setTitle(`${p.name} — Amina`);
    this.analytics.viewItem({ id: p.id, name: p.name, price: p.price, category: p.category_name });
    this.active.set(0);
    this.qty.set(1);
    this.openSection.set(0);
    const firstInStock = p.variants.find((v) => v.stock > 0) ?? p.variants.find((v) => available(v) > 0) ?? p.variants[0];
    this.color.set(firstInStock?.color ?? '');
    this.size.set('');
    const onlyOne = p.variants.filter((v) => v.color === this.color());
    if (onlyOne.length === 1 && available(onlyOne[0]) > 0) this.size.set(onlyOne[0].size);
    this.trackRecent(p);
  }

  private trackRecent(p: ProductDetail) {
    const list = storage.get<ProductCard[]>('amina.recent', []).filter((x) => x.id !== p.id);
    this.recent.set(list.slice(0, 4));
    const card: ProductCard = {
      id: p.id,
      name: p.name,
      slug: p.slug,
      price: p.price,
      old_price: p.old_price,
      is_new: p.is_new,
      is_featured: p.is_featured,
      category_slug: p.category_slug,
      category_name: p.category_name,
      images: p.images.slice(0, 2).map((i) => i.url),
      colors: this.colors(),
      sizes: [...new Set(p.variants.map((v) => v.size).filter(Boolean))],
      in_stock: p.variants.some((v) => v.stock > 0),
      preorder: !p.variants.some((v) => v.stock > 0) && p.variants.some((v) => (v.preorder ?? 0) > 0),
      incoming: !p.variants.some((v) => v.stock > 0) && p.variants.some((v) => v.incoming),
    };
    storage.set('amina.recent', [card, ...list].slice(0, 10));
  }

  selectColor(name: string) {
    this.color.set(name);
    this.active.set(0);
    if (this.size() && !this.sizes().find((s) => s.size === this.size() && (s.stock > 0 || s.pre > 0 || s.inc))) this.size.set('');
  }

  step(d: number) {
    const n = this.images().length;
    if (n) this.active.set((this.active() + d + n) % n);
  }

  zoomMove(e: MouseEvent) {
    if (window.innerWidth < 900) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.zoom.set(`${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`);
  }

  tStart(e: TouchEvent) {
    this.touchX = e.touches[0]?.clientX ?? 0;
  }
  tEnd(e: TouchEvent) {
    const dx = (e.changedTouches[0]?.clientX ?? 0) - this.touchX;
    if (Math.abs(dx) > 40) this.step(dx < 0 ? 1 : -1);
  }

  addToCart() {
    const p = this.p();
    if (!p) return;
    if (this.sizes().length && !this.size()) {
      this.shake.set(true);
      setTimeout(() => this.shake.set(false), 500);
      this.toasts.show('Оберіть розмір');
      document.querySelector('.sizes')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const v = this.variant();
    if (!v || available(v) <= 0) {
      if (v?.incoming) this.alertOpen.set(true);
      else this.toasts.error('Цього варіанту немає в наявності');
      return;
    }
    const preorder = v.stock <= 0;
    this.cart.add(
      {
        variantId: v.id,
        productId: p.id,
        slug: p.slug,
        name: p.name,
        image: this.images()[0]?.url ?? null,
        size: v.size,
        color: v.color,
        price: v.price ?? p.price,
        oldPrice: p.old_price,
        stock: available(v),
        preorder,
        eta: preorder ? (v.preorder_eta ?? null) : null,
      },
      this.qty(),
    );
  }

  toggleWish() {
    const p = this.p();
    if (!p) return;
    const card: ProductCard = {
      id: p.id, name: p.name, slug: p.slug, price: p.price, old_price: p.old_price, is_new: p.is_new, is_featured: p.is_featured,
      category_slug: p.category_slug, category_name: p.category_name, images: p.images.slice(0, 2).map((i) => i.url),
      colors: this.colors(), sizes: [...new Set(p.variants.map((v) => v.size).filter(Boolean))],
      in_stock: p.variants.some((v) => v.stock > 0), preorder: this.onlyPreorder(), incoming: this.onlyIncoming(),
    };
    this.toasts.show(this.wishlist.toggle(card) ? 'Додано в обране' : 'Прибрано з обраного');
  }
}
