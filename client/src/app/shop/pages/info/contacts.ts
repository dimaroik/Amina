import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Store } from '../../../core/store.service';
import { Icon } from '../../../shared/icon';
import { INFO_STYLES } from './info-styles';

@Component({
  selector: 'app-contacts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <section class="container page">
      <div class="head">
        <span class="eyebrow">Ми на зв'язку</span>
        <h1 class="h1">Контакти</h1>
        <p>Допоможемо з розміром, наявністю чи замовленням — пишіть у зручний месенджер.</p>
      </div>
      @if (s(); as s) {
        <div class="grid">
          <a class="card" [href]="'tel:' + phoneHref()"><app-icon name="phone" [size]="22" /><span class="eyebrow">Телефон</span><span class="v">{{ s.phone }}</span></a>
          <a class="card" [href]="'mailto:' + s.email"><app-icon name="mail" [size]="22" /><span class="eyebrow">Email</span><span class="v">{{ s.email }}</span></a>
          <div class="card"><app-icon name="clock" [size]="22" /><span class="eyebrow">Графік</span><span class="v">{{ s.workHours }}</span></div>
          <div class="card"><app-icon name="pin" [size]="22" /><span class="eyebrow">Адреса</span><span class="v">{{ s.address }}</span></div>
        </div>
        @if (messengers().length) {
          <div class="messengers">
            @for (m of messengers(); track m.icon) {
              <a class="btn btn-outline" [href]="m.url" target="_blank" rel="noopener"><app-icon [name]="m.icon" [size]="18" /> {{ m.label }}</a>
            }
          </div>
        }
      }
    </section>
  `,
  styles: `${INFO_STYLES}
    .grid { display: grid; gap: 12px; grid-template-columns: 1fr; }
    @media (min-width: 600px) { .grid { grid-template-columns: 1fr 1fr; } }
    .card { display: flex; flex-direction: column; gap: 10px; padding: 28px; background: var(--surface); border: 1px solid var(--line); transition: border-color .2s, transform .2s var(--ease); }
    a.card:hover { border-color: var(--ink); transform: translateY(-2px); }
    .v { font-family: var(--font-serif); font-size: 22px; }
    .messengers { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 40px; }
  `,
})
export class ContactsPage {
  private store = inject(Store);
  protected s = computed(() => this.store.settings()?.store ?? null);
  protected phoneHref = computed(() => (this.s()?.phone ?? '').replace(/[^\d+]/g, ''));
  protected messengers = computed(() => {
    const s = this.s();
    if (!s) return [];
    return [
      { icon: 'telegram', label: 'Telegram', url: s.telegram },
      { icon: 'viber', label: 'Viber', url: s.viber },
      { icon: 'whatsapp', label: 'WhatsApp', url: s.whatsapp },
      { icon: 'instagram', label: 'Instagram', url: s.instagram },
    ].filter((m) => !!m.url);
  });
}
