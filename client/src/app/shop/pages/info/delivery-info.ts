import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Store } from '../../../core/store.service';
import { Icon } from '../../../shared/icon';
import { UahPipe } from '../../../shared/uah.pipe';
import { INFO_STYLES } from './info-styles';

@Component({
  selector: 'app-delivery-info',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, UahPipe],
  template: `
    <section class="container page">
      <div class="head">
        <span class="eyebrow">Покупцям</span>
        <h1 class="h1">Доставка й оплата</h1>
        <p>Відправляємо по всій Україні протягом 1–2 робочих днів після підтвердження.</p>
      </div>
      @if (cfg(); as c) {
        <h2 class="h3 title"><app-icon name="truck" [size]="22" /> Доставка</h2>
        <div class="list">
          @for (d of c.delivery; track d.id) {
            <div class="row">
              <div><b>{{ d.name }}</b><p class="muted small">{{ d.description }}</p></div>
              <div class="price">
                {{ d.price > 0 ? (d.price | uah) : 'за тарифами перевізника' }}
                @if (d.free_from) { <span class="small muted">безкоштовно від {{ d.free_from | uah }}</span> }
              </div>
            </div>
          }
        </div>
        <h2 class="h3 title"><app-icon name="card" [size]="22" /> Оплата</h2>
        <div class="list">
          @for (p of c.payments; track p.id) {
            <div class="row"><div><b>{{ p.name }}</b><p class="muted small">{{ p.description }}</p></div>
              @if (p.code === 'mono_jar') { <app-icon name="qr" [size]="22" /> }
            </div>
          }
        </div>
      }
      <h2 class="h3 title"><app-icon name="refresh" [size]="22" /> Обмін і повернення</h2>
      <div class="text">
        <p>Ви можете повернути або обміняти річ протягом 14 днів з моменту отримання, якщо вона не була у використанні, збережено бірки та товарний вигляд.</p>
        <p>Щоб оформити повернення, напишіть нам у месенджер або в чат на сайті, вказавши номер замовлення. Кошти повертаємо протягом 1–3 робочих днів після отримання посилки.</p>
      </div>
      <div class="cta">
        <p>Залишились питання?</p>
        <a class="btn btn-outline" routerLink="/faq">Питання та відповіді</a>
      </div>
    </section>
  `,
  styles: `${INFO_STYLES}
    .title { display: flex; align-items: center; gap: 12px; margin: 48px 0 16px; }
    .list { border-top: 1px solid var(--line); }
    .row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 18px 0; border-bottom: 1px solid var(--line); }
    .row p { margin: 4px 0 0; }
    .price { text-align: right; display: flex; flex-direction: column; font-weight: 500; white-space: nowrap; }
    .text p { line-height: 1.8; color: var(--ink-2); }
  `,
})
export class DeliveryInfoPage {
  protected cfg = toSignal(inject(Store).checkoutConfig());
}
