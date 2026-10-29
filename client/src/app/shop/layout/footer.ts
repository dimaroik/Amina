import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { Store } from '../../core/store.service';
import { Toasts } from '../../core/toast.service';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-footer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon],
  template: `
    <footer class="footer">
      <div class="container">
        <div class="top">
          <div class="brand">
            <div class="logo">{{ s()?.name ?? 'Amina' }}</div>
            <p class="muted small">{{ s()?.tagline }}</p>
            <form class="subscribe" (submit)="subscribe($event)">
              <label class="eyebrow" for="footer-email">Розсилка: новинки та закриті розпродажі</label>
              <div class="sub-row">
                <input id="footer-email" class="sub-input" type="email" placeholder="Ваш email" [value]="email()" (input)="email.set($any($event.target).value)" required />
                <button class="sub-btn" [disabled]="busy()" aria-label="Підписатися"><app-icon name="arrow-right" /></button>
              </div>
            </form>
          </div>
          <div class="col">
            <div class="eyebrow">Магазин</div>
            @for (c of categories(); track c.id) { <a [routerLink]="['/catalog', c.slug]" class="link">{{ c.name }}</a> }
            <a routerLink="/catalog" [queryParams]="{ sale: 1 }" class="link">Sale</a>
          </div>
          <div class="col">
            <div class="eyebrow">Допомога</div>
            <a routerLink="/delivery" class="link">Доставка й оплата</a>
            <a routerLink="/faq" class="link">Питання та відповіді</a>
            <a routerLink="/track" class="link">Відстежити замовлення</a>
            <a routerLink="/contacts" class="link">Контакти</a>
            <a routerLink="/about" class="link">Про бренд</a>
          </div>
          <div class="col">
            <div class="eyebrow">Зв'язок</div>
            @if (s()?.phone) { <a [href]="'tel:' + phoneHref()" class="link">{{ s()!.phone }}</a> }
            @if (s()?.email) { <a [href]="'mailto:' + s()!.email" class="link">{{ s()!.email }}</a> }
            <span class="muted small">{{ s()?.workHours }}</span>
            <div class="socials">
              @for (soc of socials(); track soc.icon) {
                <a [href]="soc.url" target="_blank" rel="noopener" class="icon-btn" [attr.aria-label]="soc.icon"><app-icon [name]="soc.icon" [size]="18" /></a>
              }
            </div>
          </div>
        </div>
        <div class="bottom">
          <span>© {{ year }} {{ s()?.name ?? 'Amina' }}. Усі права захищено.</span>
          <span class="pay">Visa · Mastercard · Apple Pay · monobank</span>
        </div>
      </div>
    </footer>
  `,
  styles: `
    .footer { background: var(--surface-2); margin-top: 80px; padding: 64px 0 28px; font-size: 14px; }
    .top { display: grid; gap: 40px; grid-template-columns: 1fr 1fr; }
    .brand { grid-column: 1 / -1; }
    @media (min-width: 900px) { .top { grid-template-columns: 1.6fr 1fr 1fr 1fr; } .brand { grid-column: auto; } }
    .logo { font-family: var(--font-serif); font-size: 30px; letter-spacing: .32em; text-transform: uppercase; margin-bottom: 6px; }
    .col { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
    .col .eyebrow { margin-bottom: 6px; }
    .subscribe { margin-top: 24px; max-width: 380px; display: flex; flex-direction: column; gap: 10px; }
    .sub-row { display: flex; border-bottom: 1px solid var(--ink); }
    .sub-input { flex: 1; border: 0; background: transparent; padding: 10px 0; outline: none; min-width: 0; }
    .sub-btn { border: 0; background: none; padding: 0 4px; display: grid; place-items: center; transition: transform .2s; }
    .sub-btn:hover { transform: translateX(3px); }
    .socials { display: flex; gap: 4px; margin-left: -10px; margin-top: 4px; }
    .bottom { margin-top: 56px; padding-top: 20px; border-top: 1px solid var(--line-strong); display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; color: var(--muted); font-size: 12px; }
  `,
})
export class Footer {
  private store = inject(Store);
  private toasts = inject(Toasts);
  protected year = new Date().getFullYear();
  protected email = signal('');
  protected busy = signal(false);
  protected s = computed(() => this.store.settings()?.store ?? null);
  protected categories = computed(() => this.store.categories().filter((c) => c.show_in_menu));
  protected phoneHref = computed(() => (this.s()?.phone ?? '').replace(/[^\d+]/g, ''));
  protected socials = computed(() => {
    const s = this.s();
    if (!s) return [];
    return (
      [
        ['instagram', s.instagram],
        ['telegram', s.telegram],
        ['viber', s.viber],
        ['whatsapp', s.whatsapp],
        ['facebook', s.facebook],
        ['tiktok', s.tiktok],
      ] as const
    )
      .filter(([, url]) => !!url)
      .map(([icon, url]) => ({ icon, url }));
  });

  subscribe(e: Event) {
    e.preventDefault();
    this.busy.set(true);
    this.store.subscribe(this.email()).subscribe({
      next: () => {
        this.busy.set(false);
        this.email.set('');
        this.toasts.success('Дякуємо! Ви підписалися на розсилку');
      },
      error: (err) => {
        this.busy.set(false);
        this.toasts.error(errorMessage(err, 'Перевірте email'));
      },
    });
  }
}
