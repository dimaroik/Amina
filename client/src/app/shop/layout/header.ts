import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, output, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { Auth } from '../../core/auth.service';
import { Cart } from '../../core/cart.service';
import { Install } from '../../core/install.service';
import type { Category } from '../../core/models';
import { Store } from '../../core/store.service';
import { Wishlist } from '../../core/wishlist.service';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, Icon],
  template: `
    @if (announcement()) {
      <div class="announce">{{ announcement() }}</div>
    }
    <header class="header" [class.scrolled]="scrolled()" (mouseleave)="openMenu.set(null)">
      <div class="bar container">
        <button class="icon-btn burger" (click)="mobileOpen.set(true)" aria-label="Меню"><app-icon name="menu" /></button>

        <nav class="nav" aria-label="Категорії">
          <a routerLink="/catalog" [queryParams]="{ new: 1 }" class="nav-link link" (mouseenter)="openMenu.set(null)">Новинки</a>
          @for (c of menu(); track c.id) {
            <a
              [routerLink]="['/catalog', c.slug]"
              routerLinkActive="active"
              class="nav-link link"
              (mouseenter)="openMenu.set(c.children.length ? c.id : null)"
              (focus)="openMenu.set(c.children.length ? c.id : null)"
              >{{ c.name }}</a
            >
          }
          <a routerLink="/catalog" [queryParams]="{ sale: 1 }" class="nav-link link sale" (mouseenter)="openMenu.set(null)">Sale</a>
        </nav>

        <a routerLink="/" class="logo" aria-label="Amina — на головну">{{ storeName() }}</a>

        <div class="actions">
          <button class="icon-btn" (click)="search.emit()" aria-label="Пошук"><app-icon name="search" /></button>
          <a class="icon-btn hide-sm" [routerLink]="auth.isLoggedIn() ? '/account' : '/login'" aria-label="Кабінет"><app-icon name="user" /></a>
          <a class="icon-btn hide-sm" routerLink="/wishlist" aria-label="Обране">
            <app-icon name="heart" />
            @if (wishlist.count()) { <span class="count">{{ wishlist.count() }}</span> }
          </a>
          <button class="icon-btn" (click)="cart.open()" aria-label="Кошик">
            <app-icon name="bag" />
            @if (cart.count()) { <span class="count" [class.bump]="bump()">{{ cart.count() }}</span> }
          </button>
        </div>
      </div>

      @if (activeMenu(); as m) {
        <div class="mega" (mouseenter)="openMenu.set(m.id)">
          <div class="container mega-inner">
            <div class="mega-col">
              <div class="eyebrow">{{ m.name }}</div>
              <a [routerLink]="['/catalog', m.slug]" class="mega-all link" (click)="openMenu.set(null)">Дивитися все</a>
            </div>
            @for (child of m.children; track child.id) {
              <div class="mega-col">
                <a [routerLink]="['/catalog', child.slug]" class="mega-title" (click)="openMenu.set(null)">{{ child.name }}</a>
                @for (g of child.children; track g.id) {
                  <a [routerLink]="['/catalog', g.slug]" class="mega-link link" (click)="openMenu.set(null)">{{ g.name }}</a>
                }
              </div>
            }
          </div>
        </div>
      }
    </header>

    <!-- mobile menu -->
    <div class="scrim" [class.show]="mobileOpen()" (click)="mobileOpen.set(false)"></div>
    <aside class="mobile" [class.open]="mobileOpen()" aria-label="Меню">
      <div class="mobile-head">
        <span class="logo small">{{ storeName() }}</span>
        <button class="icon-btn" (click)="mobileOpen.set(false)" aria-label="Закрити"><app-icon name="close" /></button>
      </div>
      <div class="mobile-body">
        <a routerLink="/catalog" [queryParams]="{ new: 1 }" class="m-link">Новинки</a>
        @for (c of menu(); track c.id) {
          <div class="m-group">
            <div class="m-row">
              <a [routerLink]="['/catalog', c.slug]" class="m-link">{{ c.name }}</a>
              @if (c.children.length) {
                <button class="icon-btn" (click)="toggleGroup(c.id)" [attr.aria-expanded]="expanded().has(c.id)">
                  <app-icon [name]="expanded().has(c.id) ? 'minus' : 'plus'" [size]="18" />
                </button>
              }
            </div>
            @if (expanded().has(c.id)) {
              <div class="m-sub">
                @for (child of c.children; track child.id) {
                  <a [routerLink]="['/catalog', child.slug]" class="m-sublink">{{ child.name }}</a>
                  @for (g of child.children; track g.id) {
                    <a [routerLink]="['/catalog', g.slug]" class="m-sublink deep">{{ g.name }}</a>
                  }
                }
              </div>
            }
          </div>
        }
        <a routerLink="/catalog" [queryParams]="{ sale: 1 }" class="m-link sale">Sale</a>
        <div class="m-secondary">
          <a [routerLink]="auth.isLoggedIn() ? '/account' : '/login'"><app-icon name="user" [size]="18" /> {{ auth.isLoggedIn() ? 'Мій кабінет' : 'Увійти' }}</a>
          <a routerLink="/wishlist"><app-icon name="heart" [size]="18" /> Обране ({{ wishlist.count() }})</a>
          <a routerLink="/track"><app-icon name="truck" [size]="18" /> Відстежити замовлення</a>
          <a routerLink="/delivery"><app-icon name="card" [size]="18" /> Доставка й оплата</a>
          <a routerLink="/contacts"><app-icon name="phone" [size]="18" /> Контакти</a>
          @if (install.canInstall()) {
            <button class="m-install" (click)="mobileOpen.set(false); install.install()"><app-icon name="smartphone" [size]="18" /> Встановити застосунок</button>
          }
        </div>
      </div>
    </aside>
  `,
  styles: `
    :host { display: contents; }
    .announce { background: var(--ink); color: var(--bg); text-align: center; font-size: 11px; letter-spacing: .16em; text-transform: uppercase; padding: 9px 16px; }
    .header { position: sticky; top: 0; z-index: 100; background: rgba(250,248,245,.92); backdrop-filter: saturate(1.4) blur(12px); border-bottom: 1px solid transparent; transition: background .3s, border-color .3s, box-shadow .3s; }
    .header.scrolled { border-bottom-color: var(--line); }
    .bar { height: var(--header-h); display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 16px; }
    .logo { font-family: var(--font-serif); font-size: 26px; letter-spacing: .34em; text-transform: uppercase; padding-left: .34em; grid-column: 2; white-space: nowrap; }
    .logo.small { font-size: 22px; }
    .nav { display: none; gap: 26px; grid-column: 1; grid-row: 1; }
    .nav-link { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; font-weight: 500; padding: 8px 0; white-space: nowrap; }
    .sale { color: var(--sale); }
    .burger { grid-column: 1; grid-row: 1; justify-self: start; margin-left: -10px; }
    .actions { grid-column: 3; display: flex; justify-content: flex-end; gap: 2px; margin-right: -10px; }
    .count { position: absolute; top: 4px; right: 2px; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 9px; background: var(--ink); color: var(--bg); font-size: 10px; font-weight: 600; display: grid; place-items: center; }
    .count.bump { animation: bump .45s var(--ease); }
    @keyframes bump { 40% { transform: scale(1.4); } }
    .hide-sm { display: none; }
    @media (min-width: 600px) { .hide-sm { display: inline-grid; } }
    @media (min-width: 1100px) {
      .nav { display: flex; }
      .burger { display: none; }
      .logo { font-size: 30px; }
    }
    .mega { position: absolute; left: 0; right: 0; top: 100%; background: var(--bg); border-bottom: 1px solid var(--line); box-shadow: 0 30px 40px -30px rgba(0,0,0,.15); animation: drop .3s var(--ease); }
    @keyframes drop { from { opacity: 0; transform: translateY(-6px); } }
    .mega-inner { display: flex; gap: 64px; padding-top: 32px; padding-bottom: 40px; }
    .mega-col { display: flex; flex-direction: column; gap: 10px; min-width: 140px; }
    .mega-all { font-size: 14px; margin-top: 6px; align-self: flex-start; }
    .mega-title { font-family: var(--font-serif); font-size: 22px; }
    .mega-title:hover { color: var(--accent); }
    .mega-link { font-size: 14px; color: var(--ink-2); align-self: flex-start; }
    .scrim { position: fixed; inset: 0; background: rgba(31,29,26,.35); opacity: 0; pointer-events: none; transition: opacity .3s; z-index: 200; }
    .scrim.show { opacity: 1; pointer-events: auto; }
    .mobile { position: fixed; top: 0; bottom: 0; left: 0; width: min(380px, 88vw); background: var(--bg); z-index: 201; transform: translateX(-100%); transition: transform .4s var(--ease); display: flex; flex-direction: column; }
    .mobile.open { transform: none; box-shadow: var(--shadow-lg); }
    .mobile-head { display: flex; align-items: center; justify-content: space-between; height: var(--header-h); padding: 0 12px 0 20px; border-bottom: 1px solid var(--line); }
    .mobile-body { overflow-y: auto; padding: 12px 20px 32px; }
    .m-row { display: flex; align-items: center; justify-content: space-between; }
    .m-link { display: block; font-family: var(--font-serif); font-size: 26px; padding: 10px 0; }
    .m-sub { display: flex; flex-direction: column; padding: 0 0 12px 4px; animation: drop .25s var(--ease); }
    .m-sublink { padding: 7px 0; color: var(--ink-2); font-size: 15px; }
    .m-sublink.deep { padding-left: 14px; font-size: 14px; color: var(--muted); }
    .m-secondary { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 4px; }
    .m-secondary a, .m-install { display: flex; align-items: center; gap: 12px; padding: 10px 0; font-size: 14px; }
    .m-install { border: 0; background: none; color: inherit; font: inherit; font-size: 14px; cursor: pointer; text-align: left; }
  `,
})
export class Header {
  protected auth = inject(Auth);
  protected cart = inject(Cart);
  protected wishlist = inject(Wishlist);
  protected install = inject(Install);
  private store = inject(Store);
  private router = inject(Router);
  readonly search = output<void>();

  protected scrolled = signal(false);
  protected mobileOpen = signal(false);
  protected openMenu = signal<number | null>(null);
  protected expanded = signal(new Set<number>());
  protected bump = signal(false);

  private url = toSignal(this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map(() => this.router.url)), {
    initialValue: this.router.url,
  });
  protected storeName = computed(() => this.store.settings()?.store.name ?? 'Amina');
  protected announcement = computed(() => this.store.settings()?.store.announcement ?? '');
  protected menu = computed(() => this.store.categories().filter((c) => c.show_in_menu));
  protected activeMenu = computed<Category | null>(() => this.menu().find((c) => c.id === this.openMenu()) ?? null);

  constructor() {
    effect(() => {
      this.url();
      this.mobileOpen.set(false);
      this.openMenu.set(null);
    });
    effect(() => {
      if (this.cart.pulse()) {
        this.bump.set(false);
        requestAnimationFrame(() => this.bump.set(true));
      }
    });
    effect(() => {
      document.body.style.overflow = this.mobileOpen() ? 'hidden' : '';
    });
  }

  @HostListener('window:scroll')
  onScroll() {
    this.scrolled.set(window.scrollY > 8);
  }

  toggleGroup(id: number) {
    this.expanded.update((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
}
