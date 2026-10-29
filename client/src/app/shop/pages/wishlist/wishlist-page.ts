import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Wishlist } from '../../../core/wishlist.service';
import { Icon } from '../../../shared/icon';
import { ProductCardView } from '../../../shared/product-card';

@Component({
  selector: 'app-wishlist-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, ProductCardView],
  template: `
    <section class="container page">
      <div class="head">
        <span class="eyebrow">Збережене</span>
        <h1 class="h1">Обране</h1>
        @if (wishlist.count()) { <p class="muted">{{ wishlist.count() }} {{ wishlist.count() === 1 ? 'річ' : 'речей' }}, які вам сподобались</p> }
      </div>
      @if (wishlist.items().length) {
        <div class="grid-products">
          @for (p of wishlist.items(); track p.id) { <app-product-card [product]="p" /> }
        </div>
      } @else {
        <div class="empty-state">
          <app-icon name="heart" [size]="40" [stroke]="1" />
          <p class="h3">Тут поки порожньо</p>
          <p>Натискайте ♡ на товарах, щоб зберегти їх на потім</p>
          <a class="btn" routerLink="/catalog">До каталогу</a>
        </div>
      }
    </section>
  `,
  styles: `
    .page { padding-top: 48px; padding-bottom: 80px; }
    .head { text-align: center; margin-bottom: 40px; display: flex; flex-direction: column; gap: 8px; align-items: center; }
    .head p { margin: 0; }
    .empty-state app-icon { margin: 0 auto 16px; }
  `,
})
export class WishlistPage {
  protected wishlist = inject(Wishlist);
}
