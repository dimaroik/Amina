import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Store } from '../../../core/store.service';
import { Reveal } from '../../../shared/reveal.directive';
import { INFO_STYLES } from './info-styles';

@Component({
  selector: 'app-about',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Reveal],
  template: `
    <section class="container page">
      <div class="head">
        <span class="eyebrow">Про бренд</span>
        <h1 class="display">{{ s()?.name ?? 'Amina' }}</h1>
        <p>{{ s()?.tagline }}</p>
      </div>
      <div class="visual" appReveal><img src="/demo/hero-3.svg" alt="" /></div>
      <p class="lead" appReveal>{{ s()?.about }}</p>
      <div class="values">
        @for (v of values; track v.t; let i = $index) {
          <div class="value" appReveal [revealDelay]="i * 120">
            <span class="num serif">0{{ i + 1 }}</span>
            <h3 class="h3">{{ v.t }}</h3>
            <p class="muted">{{ v.d }}</p>
          </div>
        }
      </div>
      <div class="cta" appReveal>
        <h2 class="h2">Знайдіть свою річ</h2>
        <p>Нові моделі з'являються щотижня</p>
        <a class="btn" routerLink="/catalog">Дивитися колекцію</a>
      </div>
    </section>
  `,
  styles: `${INFO_STYLES}
    .page { max-width: 1040px; }
    .visual { aspect-ratio: 16 / 7; overflow: hidden; background: var(--surface-2); margin-bottom: 48px; }
    .visual img { width: 100%; height: 100%; object-fit: cover; }
    .lead { font-family: var(--font-serif); font-size: clamp(22px, 2.6vw, 30px); line-height: 1.45; text-align: center; max-width: 820px; margin: 0 auto 64px; white-space: pre-line; }
    .values { display: grid; gap: 32px; grid-template-columns: 1fr; }
    @media (min-width: 900px) { .values { grid-template-columns: repeat(3, 1fr); } }
    .value { border-top: 1px solid var(--ink); padding-top: 20px; display: flex; flex-direction: column; gap: 10px; }
    .num { font-size: 18px; color: var(--accent); }
    .value p { margin: 0; line-height: 1.7; }
  `,
})
export class AboutPage {
  private store = inject(Store);
  protected s = computed(() => this.store.settings()?.store);
  protected values = [
    { t: 'Природні тканини', d: 'Льон, бавовна, вовна й віскоза — матеріали, у яких комфортно з ранку до вечора.' },
    { t: 'Лаконічний крій', d: 'Речі поза сезонами й трендами, які легко поєднуються між собою.' },
    { t: 'Увага до деталей', d: 'Перевіряємо кожну річ перед відправкою й допомагаємо з вибором розміру.' },
  ];
}
