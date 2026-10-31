import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CartDrawer } from './cart-drawer';
import { ChatWidget } from './chat-widget';
import { Footer } from './footer';
import { Header } from './header';
import { InstallBanner } from './install-banner';
import { InstallSheet } from '../../shared/install-sheet';
import { SearchOverlay } from './search-overlay';

@Component({
  selector: 'app-shop-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, Header, Footer, CartDrawer, SearchOverlay, ChatWidget, InstallBanner, InstallSheet],
  template: `
    <app-header (search)="searchOpen.set(true)" />
    <main class="main"><router-outlet /></main>
    <app-footer />
    <app-cart-drawer />
    <app-search-overlay [(open)]="searchOpen" />
    <app-chat-widget />
    <app-install-banner />
    <app-install-sheet />
  `,
  styles: `.main { min-height: 60vh; }`,
})
export class ShopLayout {
  protected searchOpen = signal(false);
}
