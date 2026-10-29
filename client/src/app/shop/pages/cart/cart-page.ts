import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Cart } from '../../../core/cart.service';
import type { CartItem } from '../../../core/models';
import { Icon } from '../../../shared/icon';
import { UahPipe } from '../../../shared/uah.pipe';

@Component({
  selector: 'app-cart-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, UahPipe],
  template: `
    <section class="container page">
      <h1 class="h1">Кошик @if (cart.count()) { <sup class="muted">{{ cart.count() }}</sup> }</h1>

      @if (notes().length) {
        <div class="notes">
          <app-icon name="info" [size]="18" />
          <div>@for (n of notes(); track n) { <p>{{ n }}</p> }</div>
        </div>
      }

      @if (!cart.items().length) {
        <div class="empty-state">
          <app-icon name="bag" [size]="40" />
          <p class="h3">Ваш кошик порожній</p>
          <p>Додайте речі, які вам сподобались, — вони чекатимуть тут.</p>
          <a class="btn" routerLink="/catalog">Перейти до каталогу</a>
        </div>
      } @else {
        <div class="layout">
          <div class="items">
            <div class="row-head small muted"><span>Товар</span><span>Кількість</span><span>Сума</span></div>
            @for (i of cart.items(); track i.variantId) {
              <div class="item">
                <a class="thumb" [routerLink]="['/product', i.slug]">
                  @if (i.image) { <img [src]="i.image" [alt]="i.name" /> }
                </a>
                <div class="meta">
                  <a class="name" [routerLink]="['/product', i.slug]">{{ i.name }}</a>
                  <span class="small muted">{{ label(i) }}</span>
                  <span class="small">
                    {{ i.price | uah }}
                    @if (i.oldPrice && i.oldPrice > i.price) { <span class="price-old">{{ i.oldPrice | uah }}</span> }
                  </span>
                  <button class="remove small" (click)="cart.remove(i.variantId)"><app-icon name="trash" [size]="14" /> Видалити</button>
                </div>
                <div class="qty">
                  <button (click)="cart.setQuantity(i.variantId, i.quantity - 1)" aria-label="Менше"><app-icon name="minus" [size]="14" /></button>
                  <span>{{ i.quantity }}</span>
                  <button (click)="cart.setQuantity(i.variantId, i.quantity + 1)" [disabled]="i.quantity >= i.stock" aria-label="Більше"><app-icon name="plus" [size]="14" /></button>
                </div>
                <div class="line">{{ i.price * i.quantity | uah }}</div>
              </div>
            }
            <a class="link small upper back" routerLink="/catalog"><app-icon name="arrow-left" [size]="14" /> Продовжити покупки</a>
          </div>

          <aside class="summary">
            <h2 class="h3">Разом</h2>
            <div class="sum-row"><span>Товари ({{ cart.count() }})</span><span>{{ cart.subtotal() + cart.savings() | uah }}</span></div>
            @if (cart.savings() > 0) { <div class="sum-row sale"><span>Знижка</span><span>−{{ cart.savings() | uah }}</span></div> }
            <div class="sum-row muted"><span>Доставка</span><span>розраховується далі</span></div>
            <div class="sum-row total"><span>До сплати</span><span>{{ cart.subtotal() | uah }}</span></div>
            <a class="btn btn-block" routerLink="/checkout">Оформити замовлення <app-icon name="arrow-right" [size]="16" /></a>
            <p class="hint promo"><app-icon name="tag" [size]="16" /> Маєте промокод? Застосуйте його на кроці оформлення.</p>
            <ul class="perks small muted">
              <li><app-icon name="truck" [size]="16" /> Відправка за 1–2 дні</li>
              <li><app-icon name="refresh" [size]="16" /> Повернення 14 днів</li>
            </ul>
          </aside>
        </div>
      }
    </section>
  `,
  styles: `
    .page { padding-top: 36px; padding-bottom: 96px; }
    h1 { margin-bottom: 28px; } sup { font-family: var(--font-sans); font-size: 14px; }
    .notes { display: flex; gap: 12px; padding: 14px 16px; background: #f4efe2; color: #6f5a2b; margin-bottom: 24px; font-size: 14px; p { margin: 0; } }
    .empty-state app-icon { margin: 0 auto 16px; }
    .layout { display: grid; gap: 40px; }
    @media (min-width: 900px) { .layout { grid-template-columns: 1fr 360px; gap: 64px; align-items: start; } }
    .row-head { display: none; }
    @media (min-width: 700px) { .row-head { display: grid; grid-template-columns: 1fr 120px 110px; padding-bottom: 12px; border-bottom: 1px solid var(--line); text-transform: uppercase; letter-spacing: .12em; font-size: 11px; span:not(:first-child) { text-align: right; } span:nth-child(2) { text-align: center; } } }
    .item { display: grid; grid-template-columns: 96px 1fr; grid-template-areas: 'thumb meta' 'thumb qty' 'thumb line'; gap: 6px 16px; padding: 20px 0; border-bottom: 1px solid var(--line); animation: in .4s var(--ease); }
    @media (min-width: 700px) { .item { grid-template-columns: 110px 1fr 120px 110px; grid-template-areas: 'thumb meta qty line'; align-items: center; } }
    @keyframes in { from { opacity: 0; transform: translateY(8px); } }
    .thumb { grid-area: thumb; aspect-ratio: 3 / 4; background: var(--surface-2); img { width: 100%; height: 100%; object-fit: cover; } }
    .meta { grid-area: meta; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
    .name { font-size: 15px; } .name:hover { text-decoration: underline; text-underline-offset: 3px; }
    .remove { background: none; border: 0; padding: 0; margin-top: 6px; display: inline-flex; gap: 6px; align-items: center; color: var(--muted); } .remove:hover { color: var(--danger); }
    .qty { grid-area: qty; display: inline-flex; align-items: center; justify-self: start; border: 1px solid var(--line-strong); height: 38px;
      button { width: 34px; height: 100%; border: 0; background: none; display: grid; place-items: center; } button:disabled { opacity: .3; }
      span { min-width: 24px; text-align: center; font-size: 14px; } }
    @media (min-width: 700px) { .qty { justify-self: center; } }
    .line { grid-area: line; font-weight: 500; }
    @media (min-width: 700px) { .line { text-align: right; } }
    .back { margin-top: 24px; display: inline-flex; gap: 8px; align-items: center; }
    .summary { background: var(--surface); border: 1px solid var(--line); padding: 28px; display: flex; flex-direction: column; gap: 14px; position: sticky; top: calc(var(--header-h) + 24px); }
    .sum-row { display: flex; justify-content: space-between; font-size: 14px; }
    .sum-row.sale { color: var(--sale); }
    .sum-row.total { font-size: 18px; font-weight: 600; padding-top: 14px; border-top: 1px solid var(--line); }
    .promo { display: flex; gap: 8px; align-items: center; margin: 0; }
    .perks { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; li { display: flex; gap: 8px; align-items: center; } }
  `,
})
export class CartPage {
  protected cart = inject(Cart);
  protected notes = signal<string[]>([]);

  label(i: CartItem) {
    return [i.color, i.size && `Розмір ${i.size}`].filter(Boolean).join(' · ');
  }

  constructor() {
    this.cart.close();
    this.cart.revalidate().then((n) => this.notes.set(n)).catch(() => {});
  }
}
