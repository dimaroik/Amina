import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Auth } from '../../core/auth.service';
import { Icon } from '../../shared/icon';
import { AdminApi } from '../admin-api';
import { ConfirmHost } from '../ui/confirm';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  exact?: boolean;
  badge?: () => number;
}

@Component({
  selector: 'app-admin-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, ConfirmHost],
  template: `
    <div class="admin-shell">
      <aside class="adm-sidebar" [class.open]="menuOpen()">
        <div class="brand">
          <a routerLink="/admin" class="logo">AMINA</a>
          <span class="adm-pill">admin</span>
          <button class="icon-btn close" (click)="menuOpen.set(false)" aria-label="Закрити меню"><app-icon name="close" /></button>
        </div>
        <nav>
          @for (group of nav; track $index) {
            <div class="group">
              @for (item of group; track item.path) {
                <a [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: !!item.exact }" class="nav-link">
                  <app-icon [name]="item.icon" [size]="18" />
                  <span>{{ item.label }}</span>
                  @if (item.badge && item.badge() > 0) {
                    <span class="badge-count">{{ item.badge() }}</span>
                  }
                </a>
              }
            </div>
          }
        </nav>
        <div class="me">
          <div class="avatar">{{ initials() }}</div>
          <div class="who">
            <div class="n">{{ auth.user()?.name }}</div>
            <div class="e">{{ auth.user()?.email }}</div>
          </div>
          <button class="icon-btn" (click)="auth.logout('/admin/login')" title="Вийти" aria-label="Вийти"><app-icon name="logout" /></button>
        </div>
      </aside>
      @if (menuOpen()) {
        <div class="scrim" (click)="menuOpen.set(false)"></div>
      }
      <div class="adm-main">
        <header class="adm-topbar">
          <button class="icon-btn burger" (click)="menuOpen.set(true)" aria-label="Меню"><app-icon name="menu" /></button>
          <a routerLink="/admin" class="logo mobile-logo">AMINA</a>
          <span class="spacer"></span>
          <a routerLink="/admin/orders" [queryParams]="{ status: 'new' }" class="icon-btn bell" title="Нові замовлення">
            <app-icon name="bell" />
            @if (api.newOrders() > 0) { <span class="dot-count">{{ api.newOrders() }}</span> }
          </a>
          <a href="/" target="_blank" class="btn btn-ghost btn-sm shop-link"><app-icon name="external" [size]="15" /> <span>Відкрити магазин</span></a>
        </header>
        <router-outlet />
      </div>
      <adm-confirm-host />
    </div>
  `,
  styles: `
    .adm-sidebar { position: fixed; z-index: 60; inset: 0 auto 0 0; width: var(--adm-sidebar); background: #fbfaf8; border-right: 1px solid var(--line); display: flex; flex-direction: column; transform: translateX(-100%); transition: transform .3s var(--ease); }
    .adm-sidebar.open { transform: none; box-shadow: var(--shadow-lg); }
    .scrim { position: fixed; inset: 0; z-index: 55; background: rgba(31,29,26,.3); }
    .brand { display: flex; align-items: center; gap: 10px; height: var(--adm-topbar); padding: 0 16px 0 22px; border-bottom: 1px solid var(--line); }
    .logo { font-family: var(--font-serif); font-size: 22px; letter-spacing: .3em; }
    .close { margin-left: auto; }
    nav { flex: 1; overflow-y: auto; padding: 12px 10px; }
    .group + .group { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }
    .nav-link { display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-radius: 8px; color: var(--ink-2); font-size: 13.5px; transition: background .15s, color .15s; }
    .nav-link:hover { background: var(--surface-2); color: var(--ink); }
    .nav-link.active { background: var(--ink); color: var(--bg); }
    .nav-link span:not(.badge-count) { flex: 1; }
    .badge-count { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--sale); color: #fff; font-size: 11px; font-weight: 700; display: grid; place-items: center; }
    .me { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-top: 1px solid var(--line); }
    .avatar { width: 34px; height: 34px; border-radius: 50%; background: var(--accent-soft); display: grid; place-items: center; font-weight: 700; font-size: 12px; flex-shrink: 0; }
    .who { flex: 1; min-width: 0; font-size: 12.5px; line-height: 1.3; }
    .who .n { font-weight: 600; }
    .who .e { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .adm-main { min-width: 0; }
    .adm-topbar { position: sticky; top: 0; z-index: 40; height: var(--adm-topbar); display: flex; align-items: center; gap: 8px; padding: 0 12px; background: rgba(247,245,241,.9); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
    .spacer { flex: 1; }
    .mobile-logo { font-size: 18px; }
    .bell { position: relative; }
    .dot-count { position: absolute; top: 2px; right: 0; min-width: 16px; height: 16px; border-radius: 999px; background: var(--sale); color: #fff; font-size: 10px; font-weight: 700; display: grid; place-items: center; padding: 0 4px; }
    .shop-link span { display: none; }
    @media (min-width: 600px) { .shop-link span { display: inline; } }
    @media (min-width: 1100px) {
      .adm-sidebar { transform: none; }
      .close, .scrim, .burger, .mobile-logo { display: none; }
      .adm-main { margin-left: var(--adm-sidebar); }
      .adm-topbar { padding: 0 32px; }
    }
  `,
})
export class AdminLayout implements OnInit, OnDestroy {
  protected auth = inject(Auth);
  protected api = inject(AdminApi);
  private router = inject(Router);
  protected menuOpen = signal(false);
  private timer?: ReturnType<typeof setInterval>;

  protected nav: NavItem[][] = [
    [
      { path: '/admin', label: 'Огляд', icon: 'dashboard', exact: true },
      { path: '/admin/orders', label: 'Замовлення', icon: 'box', badge: () => this.api.newOrders() },
      { path: '/admin/customers', label: 'Клієнти', icon: 'users' },
      { path: '/admin/chats', label: 'Звернення', icon: 'chat', badge: () => this.api.waitingChats() },
      { path: '/admin/reviews', label: 'Відгуки', icon: 'star', badge: () => this.api.pendingReviews() },
    ],
    [
      { path: '/admin/products', label: 'Товари', icon: 'tag' },
      { path: '/admin/shipments', label: 'Поставки', icon: 'parcel' },
      { path: '/admin/categories', label: 'Категорії', icon: 'layers' },
      { path: '/admin/promo', label: 'Промокоди', icon: 'sparkle' },
      { path: '/admin/content', label: 'Контент', icon: 'image' },
    ],
    [
      { path: '/admin/delivery-payment', label: 'Доставка й оплата', icon: 'truck' },
      { path: '/admin/settings', label: 'Налаштування', icon: 'settings' },
      { path: '/admin/admins', label: 'Адміністратори', icon: 'user' },
    ],
  ];

  protected initials = () =>
    (this.auth.user()?.name || this.auth.user()?.email || 'A')
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

  ngOnInit() {
    this.api.refreshBadges();
    this.timer = setInterval(() => this.api.refreshBadges(), 60_000);
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) this.menuOpen.set(false);
    });
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }
}
