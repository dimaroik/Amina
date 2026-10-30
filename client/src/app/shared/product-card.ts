import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../core/api.service';
import { Cart } from '../core/cart.service';
import { preorderWhen } from '../core/labels';
import type { ProductCard as Product } from '../core/models';
import { Store } from '../core/store.service';
import { Toasts } from '../core/toast.service';
import { Wishlist } from '../core/wishlist.service';
import { Icon } from './icon';
import { UahPipe } from './uah.pipe';

@Component({
  selector: 'app-product-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, UahPipe],
  template: `
    @let p = product();
    <article class="pcard" [class.sold-out]="!p.in_stock && !p.preorder && !p.incoming">
      <div class="frame">
      <a class="media" [routerLink]="['/product', p.slug]" [attr.aria-label]="p.name">
        @if (p.images[0]) {
          <img class="img main" [src]="p.images[0]" [alt]="p.name" loading="lazy" />
        } @else {
          <div class="img placeholder"></div>
        }
        @if (p.images[1]) {
          <img class="img alt" [src]="p.images[1]" alt="" loading="lazy" />
        }
        <div class="tags">
          @if (discount() > 0) { <span class="tag tag-sale">−{{ discount() }}%</span> }
          @if (p.is_new) { <span class="tag">New</span> }
          @if (!p.in_stock) {
            @if (p.preorder) { <span class="tag tag-pre" [title]="'Передзамовлення, ' + when(p.preorder_eta)">Передзамовлення</span> }
            @else if (p.incoming) { <span class="tag tag-soon" [title]="'В дорозі, ' + when(p.incoming_eta)">В дорозі</span> }
            @else { <span class="tag tag-dark">Немає</span> }
          }
        </div>
      </a>
      <button class="wish" [class.on]="wished()" (click)="toggleWish()" [attr.aria-label]="wished() ? 'Прибрати з обраного' : 'Додати в обране'">
        <app-icon [name]="wished() ? 'heart-fill' : 'heart'" [size]="18" />
      </button>
      @if (p.in_stock && p.sizes.length) {
        <div class="quick">
          <span class="quick-label">Швидко додати</span>
          <div class="sizes">
            @for (s of p.sizes; track s) {
              <button (click)="quickAdd(s)" [disabled]="busy()">{{ s }}</button>
            }
          </div>
        </div>
      }
      </div>
      <div class="info">
        <a class="name" [routerLink]="['/product', p.slug]">{{ p.name }}</a>
        <div class="meta">
          <span class="price" [class.price-sale]="discount() > 0">{{ p.price | uah }}</span>
          @if (discount() > 0) { <span class="price-old">{{ p.old_price | uah }}</span> }
        </div>
        @if (p.colors.length > 1) {
          <div class="colors">
            @for (c of p.colors; track c.name) {
              <span class="dot" [style.background]="c.hex || '#ccc'" [title]="c.name"></span>
            }
          </div>
        }
      </div>
    </article>
  `,
  styles: `
    .pcard { position: relative; }
    .media { position: relative; display: block; aspect-ratio: 3 / 4; overflow: hidden; background: var(--surface-2); }
    .img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: opacity .6s var(--ease), transform 1.2s var(--ease); }
    .placeholder { background: var(--surface-3); }
    .alt { opacity: 0; }
    .pcard:hover .alt { opacity: 1; }
    .pcard:hover .img { transform: scale(1.035); }
    .tag-pre { background: var(--warning); color: #fff; white-space: nowrap; }
    .tag-soon { background: var(--info); color: #fff; white-space: nowrap; }
    .sold-out .img { filter: grayscale(.35); opacity: .8; }
    .tags { position: absolute; top: 10px; left: 10px; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
    .wish { position: absolute; top: 6px; right: 6px; width: 38px; height: 38px; border: 0; background: transparent; display: grid; place-items: center; color: var(--ink); border-radius: 50%; transition: transform .2s var(--ease), background .2s; }
    .wish:hover { background: rgba(255,255,255,.7); }
    .wish.on { color: var(--sale); animation: pop .35s var(--ease); }
    @keyframes pop { 50% { transform: scale(1.25); } }
    .frame { position: relative; }
    .quick { display: none; }
    @media (hover: hover) and (min-width: 900px) {
      .quick { display: block; position: absolute; left: 10px; right: 10px; bottom: 10px; transform: translateY(8px); opacity: 0; transition: all .35s var(--ease); background: rgba(250,248,245,.94); backdrop-filter: blur(6px); padding: 10px 12px; pointer-events: none; }
      .pcard:hover .quick { opacity: 1; transform: none; pointer-events: auto; }
    }
    .quick-label { display: block; font-size: 10px; letter-spacing: .18em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
    .sizes { display: flex; flex-wrap: wrap; gap: 4px; }
    .sizes button { min-width: 34px; height: 30px; padding: 0 6px; border: 1px solid var(--line-strong); background: var(--surface); font-size: 12px; transition: all .2s; }
    .sizes button:hover { background: var(--ink); color: var(--bg); border-color: var(--ink); }
    .info { padding: 12px 2px 0; }
    .name { display: block; font-size: 14px; line-height: 1.4; margin-bottom: 4px; }
    .name:hover { text-decoration: underline; text-underline-offset: 3px; }
    .meta { font-size: 14px; }
    .colors { display: flex; gap: 6px; margin-top: 8px; }
    .dot { width: 12px; height: 12px; border-radius: 50%; border: 1px solid rgba(0,0,0,.12); }
  `,
})
export class ProductCardView {
  readonly product = input.required<Product>();
  private wishlist = inject(Wishlist);
  private cart = inject(Cart);
  private store = inject(Store);
  private toasts = inject(Toasts);
  protected busy = signal(false);
  protected when = (eta: string | null | undefined) => preorderWhen(eta);

  protected wished = computed(() => this.wishlist.has(this.product().id));
  protected discount = computed(() => {
    const p = this.product();
    return p.old_price && p.old_price > p.price ? Math.round((1 - p.price / p.old_price) * 100) : 0;
  });

  toggleWish() {
    const added = this.wishlist.toggle(this.product());
    this.toasts.show(added ? 'Додано в обране' : 'Прибрано з обраного');
  }

  quickAdd(size: string) {
    this.busy.set(true);
    this.store.product(this.product().slug).subscribe({
      next: (p) => {
        this.busy.set(false);
        const v = p.variants.find((x) => x.size === size && x.stock > 0);
        if (!v) {
          this.toasts.error(`Розмір ${size} закінчився`);
          return;
        }
        this.cart.add({
          variantId: v.id,
          productId: p.id,
          slug: p.slug,
          name: p.name,
          image: p.images.find((i) => i.color === v.color)?.url ?? p.images[0]?.url ?? null,
          size: v.size,
          color: v.color,
          price: v.price ?? p.price,
          oldPrice: p.old_price,
          stock: v.stock,
        });
      },
      error: (e) => {
        this.busy.set(false);
        this.toasts.error(errorMessage(e));
      },
    });
  }
}
