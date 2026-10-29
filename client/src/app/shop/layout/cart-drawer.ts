import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Cart } from '../../core/cart.service';
import { Store } from '../../core/store.service';
import { Icon } from '../../shared/icon';
import { UahPipe } from '../../shared/uah.pipe';

@Component({
  selector: 'app-cart-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, UahPipe],
  template: `
    <div class="scrim" [class.show]="cart.drawerOpen()" (click)="cart.close()"></div>
    <aside class="drawer" [class.open]="cart.drawerOpen()" aria-label="Кошик" [attr.aria-hidden]="!cart.drawerOpen()">
      <div class="head">
        <h2 class="h3">Кошик <span class="muted">({{ cart.count() }})</span></h2>
        <button class="icon-btn" (click)="cart.close()" aria-label="Закрити"><app-icon name="close" /></button>
      </div>

      @if (cart.items().length) {
        @if (freeFrom()) {
        <div class="progress">
          @if (left() > 0) {
            <p class="small">До безкоштовної доставки залишилось <b>{{ left() | uah }}</b></p>
          } @else {
            <p class="small">🎉 Вам доступна безкоштовна доставка</p>
          }
          <div class="track"><div class="fill" [style.width.%]="progress()"></div></div>
        </div>
        }

        <ul class="items">
          @for (item of cart.items(); track item.variantId) {
            <li class="item">
              <a [routerLink]="['/product', item.slug]" (click)="cart.close()" class="thumb">
                @if (item.image) { <img [src]="item.image" [alt]="item.name" /> }
              </a>
              <div class="body">
                <div class="row top">
                  <a [routerLink]="['/product', item.slug]" (click)="cart.close()" class="name">{{ item.name }}</a>
                  <button class="remove" (click)="cart.remove(item.variantId)" aria-label="Видалити"><app-icon name="close" [size]="16" /></button>
                </div>
                <div class="muted small">{{ item.color }}@if (item.color && item.size) { · }{{ item.size }}</div>
                <div class="row bottom">
                  <div class="qty">
                    <button (click)="cart.setQuantity(item.variantId, item.quantity - 1)" aria-label="Менше"><app-icon name="minus" [size]="14" /></button>
                    <span>{{ item.quantity }}</span>
                    <button (click)="cart.setQuantity(item.variantId, item.quantity + 1)" [disabled]="item.quantity >= item.stock" aria-label="Більше"><app-icon name="plus" [size]="14" /></button>
                  </div>
                  <div class="price">
                    {{ item.price * item.quantity | uah }}
                    @if (item.oldPrice && item.oldPrice > item.price) { <span class="price-old">{{ item.oldPrice * item.quantity | uah }}</span> }
                  </div>
                </div>
              </div>
            </li>
          }
        </ul>

        <div class="foot">
          @if (cart.savings() > 0) {
            <div class="row line"><span class="muted">Ви економите</span><span class="price-sale">{{ cart.savings() | uah }}</span></div>
          }
          <div class="row line total"><span>Разом</span><span>{{ cart.subtotal() | uah }}</span></div>
          <p class="tiny muted">Вартість доставки розраховується при оформленні</p>
          <button class="btn btn-block" (click)="go('/checkout')">Оформити замовлення</button>
          <button class="btn btn-ghost btn-block btn-sm" (click)="go('/cart')">Переглянути кошик</button>
        </div>
      } @else {
        <div class="empty">
          <app-icon name="bag" [size]="40" [stroke]="1" />
          <p class="h3">Ваш кошик порожній</p>
          <p class="muted small">Перегляньте новинки — у нас є дещо особливе для вас</p>
          <button class="btn" (click)="go('/catalog')">До каталогу</button>
        </div>
      }
    </aside>
  `,
  styles: `
    .scrim { position: fixed; inset: 0; background: rgba(31,29,26,.35); opacity: 0; pointer-events: none; transition: opacity .35s; z-index: 300; }
    .scrim.show { opacity: 1; pointer-events: auto; }
    .drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(440px, 100vw); background: var(--bg); z-index: 301; display: flex; flex-direction: column; transform: translateX(100%); transition: transform .45s var(--ease); visibility: hidden; }
    .drawer.open { transform: none; box-shadow: var(--shadow-lg); visibility: visible; }
    .head { display: flex; align-items: center; justify-content: space-between; padding: 18px 16px 14px 24px; border-bottom: 1px solid var(--line); }
    .progress { padding: 14px 24px 16px; border-bottom: 1px solid var(--line); }
    .progress p { margin: 0 0 8px; }
    .track { height: 2px; background: var(--line); }
    .fill { height: 100%; background: var(--ink); transition: width .6s var(--ease); }
    .items { list-style: none; margin: 0; padding: 0 24px; overflow-y: auto; flex: 1; }
    .item { display: flex; gap: 14px; padding: 18px 0; border-bottom: 1px solid var(--line); animation: in .35s var(--ease); }
    @keyframes in { from { opacity: 0; transform: translateX(16px); } }
    .thumb { width: 84px; flex-shrink: 0; aspect-ratio: 3/4; background: var(--surface-2); overflow: hidden; }
    .thumb img { width: 100%; height: 100%; object-fit: cover; }
    .body { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .top { align-items: flex-start; }
    .name { font-size: 14px; line-height: 1.4; }
    .remove { border: 0; background: none; color: var(--muted); padding: 2px; display: grid; }
    .remove:hover { color: var(--ink); }
    .bottom { margin-top: auto; }
    .qty { display: inline-flex; align-items: center; border: 1px solid var(--line-strong); height: 34px; }
    .qty button { width: 32px; height: 100%; border: 0; background: none; display: grid; place-items: center; }
    .qty button:disabled { opacity: .3; cursor: default; }
    .qty span { min-width: 24px; text-align: center; font-size: 13px; }
    .price { font-size: 14px; text-align: right; }
    .foot { padding: 18px 24px 24px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 10px; background: var(--surface); }
    .line { font-size: 14px; }
    .total { font-size: 17px; font-weight: 600; }
    .foot p { margin: 0 0 4px; }
    .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; text-align: center; padding: 32px; color: var(--muted); }
    .empty .h3 { color: var(--ink); margin: 8px 0 0; }
  `,
})
export class CartDrawer {
  protected cart = inject(Cart);
  private router = inject(Router);
  /** Lowest "free delivery from" threshold among active delivery methods. */
  protected freeFrom = signal<number | null>(null);
  protected left = computed(() => Math.max(0, (this.freeFrom() ?? 0) - this.cart.subtotal()));
  protected progress = computed(() => Math.min(100, (this.cart.subtotal() / (this.freeFrom() || 1)) * 100));

  constructor() {
    inject(Store)
      .checkoutConfig()
      .subscribe((c) => {
        const values = c.delivery.map((d) => d.free_from).filter((v): v is number => v !== null && v > 0);
        this.freeFrom.set(values.length ? Math.min(...values) : null);
      });
    effect(() => {
      document.documentElement.style.overflow = this.cart.drawerOpen() ? 'hidden' : '';
    });
  }

  go(url: string) {
    this.cart.close();
    this.router.navigateByUrl(url);
  }

  @HostListener('document:keydown.escape')
  onEsc() {
    this.cart.close();
  }
}
