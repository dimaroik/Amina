import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { errorMessage } from '../../../core/api.service';
import type { Banner } from '../../../core/models';
import { Store } from '../../../core/store.service';
import { Toasts } from '../../../core/toast.service';
import { Icon } from '../../../shared/icon';
import { ProductCardView } from '../../../shared/product-card';
import { Reveal } from '../../../shared/reveal.directive';

const FALLBACK: Banner[] = [
  {
    id: 0,
    title: 'Нова колекція',
    subtitle: 'Природні тканини, спокійні відтінки та бездоганний крій',
    image_url: '/demo/hero-1.svg',
    link: '/catalog',
    button_text: 'Дивитися колекцію',
    sort_order: 0,
    is_active: true,
  },
];

@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, Icon, ProductCardView, Reveal],
  template: `
    <!-- HERO -->
    <section class="hero" (touchstart)="touchStart($event)" (touchend)="touchEnd($event)" (mouseenter)="paused.set(true)" (mouseleave)="paused.set(false)">
      @for (b of slides(); track b.id; let i = $index) {
        <div class="slide" [class.active]="i === current()" [attr.aria-hidden]="i !== current()">
          <img class="slide-img" [src]="b.image_url" [alt]="b.title" [attr.loading]="i === 0 ? 'eager' : 'lazy'" />
          <div class="slide-shade"></div>
          <div class="container slide-content">
            <span class="eyebrow light">{{ settings()?.store?.tagline || 'Amina' }}</span>
            <h1 class="display">{{ b.title }}</h1>
            @if (b.subtitle) { <p class="sub">{{ b.subtitle }}</p> }
            @if (b.link) {
              <a class="btn btn-light" [routerLink]="b.link">{{ b.button_text || 'Дивитися' }} <app-icon name="arrow-right" [size]="16" /></a>
            }
          </div>
        </div>
      }
      @if (slides().length > 1) {
        <div class="hero-nav container">
          <div class="dots">
            @for (b of slides(); track b.id; let i = $index) {
              <button class="dot" [class.on]="i === current()" (click)="go(i)" [attr.aria-label]="'Слайд ' + (i + 1)">
                <span class="bar" [class.run]="i === current() && !paused()"></span>
              </button>
            }
          </div>
          <div class="arrows">
            <button class="arrow" (click)="go(current() - 1)" aria-label="Попередній"><app-icon name="chevron-left" /></button>
            <button class="arrow" (click)="go(current() + 1)" aria-label="Наступний"><app-icon name="chevron-right" /></button>
          </div>
        </div>
      }
    </section>

    <!-- BENEFITS -->
    <section class="benefits">
      <div class="container benefits-row">
        <div class="benefit"><app-icon name="truck" [size]="22" /><div><b>Доставка по Україні</b><span>1–3 дні Новою поштою</span></div></div>
        <div class="benefit"><app-icon name="refresh" [size]="22" /><div><b>Повернення 14 днів</b><span>Легкий обмін розміру</span></div></div>
        <div class="benefit"><app-icon name="qr" [size]="22" /><div><b>Зручна оплата</b><span>Monobank QR, картка, при отриманні</span></div></div>
      </div>
    </section>

    <!-- CATEGORIES -->
    @if (categories().length) {
      <section class="section container">
        <div class="head" appReveal>
          <div><span class="eyebrow">Категорії</span><h2 class="h2">Оберіть своє</h2></div>
          <a class="link small upper" routerLink="/catalog">Весь каталог</a>
        </div>
        <div class="cats" [class.many]="categories().length > 3">
          @for (c of categories(); track c.id; let i = $index) {
            <a class="cat" [routerLink]="['/catalog', c.slug]" appReveal [revealDelay]="i * 80">
              <div class="cat-media" [style.background]="tone(i)">
                @if (c.image_url || catImage(c.slug)) {
                  <img [src]="c.image_url || catImage(c.slug)" [alt]="c.name" loading="lazy" />
                }
              </div>
              <div class="cat-label">
                <span class="h3">{{ c.name }}</span>
                <app-icon name="arrow-right" [size]="18" />
              </div>
            </a>
          }
        </div>
      </section>
    }

    <!-- NEW -->
    <section class="section container tight-top">
      <div class="head" appReveal>
        <div><span class="eyebrow">Щойно надійшло</span><h2 class="h2">Новинки</h2></div>
        <a class="link small upper" [routerLink]="['/catalog']" [queryParams]="{ new: 1 }">Дивитися всі</a>
      </div>
      @if (newItems(); as list) {
        <div class="rail">
          @for (p of list; track p.id; let i = $index) {
            <app-product-card class="rail-item" [product]="p" appReveal [revealDelay]="(i % 4) * 70" />
          }
        </div>
      } @else {
        <div class="rail">
          @for (i of [1, 2, 3, 4]; track i) { <div class="rail-item"><div class="skeleton sk-img"></div><div class="skeleton sk-line"></div></div> }
        </div>
      }
    </section>

    <!-- EDITORIAL -->
    <section class="editorial">
      <div class="container editorial-grid">
        <div class="ed-media" appReveal>
          <img src="/demo/coat-camel-2.svg" alt="" loading="lazy" />
          <img class="ed-small" src="/demo/knit-cream-1.svg" alt="" loading="lazy" />
        </div>
        <div class="ed-text" appReveal [revealDelay]="120">
          <span class="eyebrow">Про бренд</span>
          <h2 class="h1">Тиха розкіш щоденного гардеробу</h2>
          <p>{{ settings()?.store?.about || 'Amina — це бренд для жінок, які цінують якість, мінімалізм і комфорт.' }}</p>
          <a class="btn btn-outline" routerLink="/about">Наша історія</a>
        </div>
      </div>
    </section>

    <!-- FEATURED -->
    @if (featured()?.length) {
      <section class="section container">
        <div class="head" appReveal>
          <div><span class="eyebrow">Вибір стилістів</span><h2 class="h2">Обрані речі</h2></div>
          <a class="link small upper" routerLink="/catalog">До каталогу</a>
        </div>
        <div class="grid-products">
          @for (p of featured(); track p.id; let i = $index) {
            <app-product-card [product]="p" appReveal [revealDelay]="(i % 4) * 70" />
          }
        </div>
      </section>
    }

    <!-- NEWSLETTER -->
    <section class="newsletter">
      <div class="container nl" appReveal>
        <span class="eyebrow">Розсилка</span>
        <h2 class="h2">Будьте першою, хто дізнається про новинки</h2>
        <p class="muted">Закриті розпродажі, нові колекції та стилістичні поради — не частіше одного листа на тиждень.</p>
        @if (subscribed()) {
          <p class="thanks"><app-icon name="check" /> Дякуємо! Ви підписані.</p>
        } @else {
          <form class="nl-form" (ngSubmit)="subscribe()">
            <input class="input" type="email" name="email" [(ngModel)]="email" placeholder="Ваш email" required />
            <button class="btn" type="submit" [disabled]="sending()">Підписатися</button>
          </form>
        }
      </div>
    </section>
  `,
  styles: `
    .hero { position: relative; height: min(88vh, 860px); min-height: 520px; overflow: hidden; background: var(--surface-3); color: #fff; }
    .slide { position: absolute; inset: 0; opacity: 0; transition: opacity 1.2s var(--ease); pointer-events: none; }
    .slide.active { opacity: 1; pointer-events: auto; }
    .slide-img { width: 100%; height: 100%; object-fit: cover; transform: scale(1.08); transition: transform 7s linear; }
    .slide.active .slide-img { transform: scale(1); }
    .slide-shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(31,29,26,.55) 0%, rgba(31,29,26,.15) 55%, transparent 100%); }
    .slide-content { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; padding-bottom: 110px; gap: 18px; left: 0; right: 0; }
    .slide-content > * { max-width: 640px; opacity: 0; transform: translateY(24px); transition: all .9s var(--ease); }
    .slide.active .slide-content > * { opacity: 1; transform: none; }
    .slide.active .slide-content > *:nth-child(2) { transition-delay: .15s; }
    .slide.active .slide-content > *:nth-child(3) { transition-delay: .3s; }
    .slide.active .slide-content > *:nth-child(4) { transition-delay: .45s; }
    .slide-content .btn { align-self: flex-start; }
    .eyebrow.light { color: rgba(255,255,255,.8); }
    .sub { font-size: 17px; color: rgba(255,255,255,.88); margin: 0; }
    .hero-nav { position: absolute; left: 0; right: 0; bottom: 36px; display: flex; align-items: center; justify-content: space-between; }
    .dots { display: flex; gap: 10px; }
    .dot { width: 54px; height: 20px; border: 0; background: none; padding: 0; display: flex; align-items: center; }
    .dot::before { content: ''; position: absolute; }
    .dot { position: relative; }
    .dot .bar { position: relative; display: block; width: 100%; height: 2px; background: rgba(255,255,255,.35); overflow: hidden; }
    .dot .bar::after { content: ''; position: absolute; inset: 0; background: #fff; transform: scaleX(0); transform-origin: left; }
    .dot.on .bar::after { transform: scaleX(1); }
    .dot .bar.run::after { animation: fill 6s linear forwards; }
    @keyframes fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
    .arrows { display: flex; gap: 8px; }
    .arrow { width: 44px; height: 44px; border-radius: 50%; border: 1px solid rgba(255,255,255,.5); background: transparent; color: #fff; display: grid; place-items: center; transition: all .25s; }
    .arrow:hover { background: #fff; color: var(--ink); }
    @media (max-width: 599px) { .arrows { display: none; } .slide-content { padding-bottom: 90px; } }

    .benefits { border-bottom: 1px solid var(--line); background: var(--surface); }
    .benefits-row { display: grid; grid-template-columns: 1fr; gap: 0; }
    .benefit { display: flex; align-items: center; gap: 14px; padding: 18px 0; color: var(--ink-2); }
    .benefit + .benefit { border-top: 1px solid var(--line); }
    .benefit div { display: flex; flex-direction: column; font-size: 13px; }
    .benefit b { font-weight: 600; color: var(--ink); }
    .benefit span { color: var(--muted); }
    @media (min-width: 900px) {
      .benefits-row { grid-template-columns: repeat(3, 1fr); }
      .benefit { justify-content: center; padding: 26px 0; }
      .benefit + .benefit { border-top: 0; border-left: 1px solid var(--line); }
    }

    .head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 28px; }
    .head .eyebrow { display: block; margin-bottom: 8px; }
    .tight-top { padding-top: 0; }

    .cats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    @media (min-width: 900px) { .cats { grid-template-columns: repeat(3, 1fr); gap: 20px; } .cats.many { grid-template-columns: repeat(4, 1fr); } }
    .cat { display: block; }
    .cat-media { aspect-ratio: 4 / 5; overflow: hidden; position: relative; }
    .cat-media img { width: 100%; height: 100%; object-fit: cover; transition: transform 1.2s var(--ease); }
    .cat:hover .cat-media img { transform: scale(1.05); }
    .cat-label { display: flex; align-items: center; justify-content: space-between; padding: 14px 2px 0; }
    .cat-label app-icon { transition: transform .35s var(--ease); }
    .cat:hover .cat-label app-icon { transform: translateX(6px); }

    .rail { display: grid; grid-auto-flow: column; grid-auto-columns: 46%; gap: 12px; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; padding-bottom: 4px; }
    .rail::-webkit-scrollbar { display: none; }
    .rail-item { scroll-snap-align: start; }
    @media (min-width: 900px) { .rail { grid-auto-columns: calc((100% - 60px) / 4); gap: 20px; } }
    .sk-img { aspect-ratio: 3 / 4; }
    .sk-line { height: 14px; margin-top: 12px; width: 70%; }

    .editorial { background: var(--surface-2); padding: 64px 0; }
    @media (min-width: 900px) { .editorial { padding: 110px 0; } }
    .editorial-grid { display: grid; gap: 40px; align-items: center; }
    @media (min-width: 900px) { .editorial-grid { grid-template-columns: 1.1fr 1fr; gap: 90px; } }
    .ed-media { position: relative; padding-right: 22%; }
    .ed-media img { width: 100%; aspect-ratio: 4 / 5; object-fit: cover; }
    .ed-small { position: absolute; right: 0; bottom: -28px; width: 42% !important; border: 8px solid var(--surface-2); }
    .ed-text { display: flex; flex-direction: column; gap: 20px; align-items: flex-start; }
    .ed-text p { color: var(--ink-2); font-size: 16px; max-width: 480px; margin: 0; }

    .newsletter { border-top: 1px solid var(--line); }
    .nl { text-align: center; padding: 72px var(--gutter); max-width: 720px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
    .nl p { margin: 0; }
    .nl-form { display: flex; gap: 8px; width: 100%; max-width: 480px; margin-top: 10px; }
    .nl-form .input { flex: 1; }
    @media (max-width: 599px) { .nl-form { flex-direction: column; } }
    .thanks { display: flex; align-items: center; gap: 8px; color: var(--success); }
  `,
})
export class HomePage {
  private store = inject(Store);
  private toasts = inject(Toasts);
  private destroyRef = inject(DestroyRef);

  protected settings = this.store.settings;
  protected categories = computed(() => this.store.categories().filter((c) => c.show_in_menu));
  protected slides = toSignal(
    this.store.banners().pipe(
      map((b) => (b.length ? b : FALLBACK)),
      catchError(() => of(FALLBACK)),
    ),
    { initialValue: FALLBACK },
  );
  protected newItems = toSignal(this.store.products({ new: '1', limit: 8 }).pipe(map((r) => r.items), catchError(() => of([]))));
  protected featured = toSignal(this.store.products({ featured: '1', limit: 8, sort: 'popular' }).pipe(map((r) => r.items), catchError(() => of([]))));

  protected current = signal(0);
  protected paused = signal(false);
  protected email = '';
  protected sending = signal(false);
  protected subscribed = signal(false);
  private touchX = 0;

  private catImages: Record<string, string> = {
    sukni: '/demo/dress-linen-2.svg',
    'verkhnii-odiah': '/demo/coat-camel-1.svg',
    'topy-ta-bluzy': '/demo/blouse-white-2.svg',
    'nyz': '/demo/trousers-wide-1.svg',
  };

  constructor() {
    const timer = setInterval(() => {
      if (!this.paused() && !document.hidden && this.slides().length > 1) this.go(this.current() + 1);
    }, 6000);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  go(i: number) {
    const n = this.slides().length;
    this.current.set(((i % n) + n) % n);
  }

  touchStart(e: TouchEvent) {
    this.touchX = e.touches[0]?.clientX ?? 0;
  }
  touchEnd(e: TouchEvent) {
    const dx = (e.changedTouches[0]?.clientX ?? 0) - this.touchX;
    if (Math.abs(dx) > 50) this.go(this.current() + (dx < 0 ? 1 : -1));
  }

  tone(i: number) {
    return ['#ece6dd', '#e7e3dc', '#ede5df', '#e8e1d8'][i % 4];
  }
  catImage(slug: string) {
    return this.catImages[slug] ?? '';
  }

  subscribe() {
    if (!/^\S+@\S+\.\S+$/.test(this.email)) {
      this.toasts.error('Вкажіть коректний email');
      return;
    }
    this.sending.set(true);
    this.store.subscribe(this.email).subscribe({
      next: () => {
        this.sending.set(false);
        this.subscribed.set(true);
      },
      error: (e) => {
        this.sending.set(false);
        this.toasts.error(errorMessage(e));
      },
    });
  }
}
