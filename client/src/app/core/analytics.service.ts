import { Injectable, effect, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { Store } from './store.service';

export interface TrackedItem {
  id: number | string;
  name: string;
  price: number;
  quantity?: number;
  variant?: string;
  category?: string | null;
}

type Fn = (...args: unknown[]) => void;
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Fn;
    fbq?: Fn & { callMethod?: Fn; queue?: unknown[]; loaded?: boolean; version?: string; push?: Fn };
    _fbq?: unknown;
  }
}

/**
 * Google Analytics 4 + Meta Pixel. IDs come from the admin settings; nothing is
 * loaded until one is configured, and the storefront never depends on these scripts.
 */
@Injectable({ providedIn: 'root' })
export class Analytics {
  private store = inject(Store);
  private router = inject(Router);
  private ga = '';
  private pixel = false;
  private started = false;
  private lastPage = '';

  constructor() {
    effect(() => {
      const a = this.store.settings()?.analytics;
      if (a && !this.started) this.start(a.ga4Id, a.metaPixelId);
    });
  }

  private start(ga4Id: string, pixelId: string) {
    this.started = true;
    if (/^G-[A-Z0-9]+$/.test(ga4Id)) {
      this.ga = ga4Id;
      window.dataLayer = window.dataLayer || [];
      // gtag must push the arguments object itself
      window.gtag = function gtag() {
        // eslint-disable-next-line prefer-rest-params
        window.dataLayer!.push(arguments);
      };
      window.gtag('js', new Date());
      window.gtag('config', ga4Id, { send_page_view: false });
      this.script(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id)}`);
    }
    if (/^\d+$/.test(pixelId)) {
      this.pixel = true;
      const f = function (...args: unknown[]) {
        f.callMethod ? f.callMethod(...args) : f.queue!.push(args);
      } as NonNullable<Window['fbq']>;
      f.push = f;
      f.loaded = true;
      f.version = '2.0';
      f.queue = [];
      window.fbq = window._fbq = f;
      this.script('https://connect.facebook.net/en_US/fbevents.js');
      window.fbq('init', pixelId);
    }
    if (!this.ga && !this.pixel) return;
    this.pageView();
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.pageView());
  }

  private script(src: string) {
    const s = document.createElement('script');
    s.async = true;
    s.src = src;
    document.head.appendChild(s);
  }

  private pageView() {
    // the admin panel is not part of the shop funnel
    if (location.pathname.startsWith('/admin')) return;
    // the first route can be reported both at start-up and by its NavigationEnd
    if (location.href === this.lastPage) return;
    this.lastPage = location.href;
    this.ga && window.gtag?.('event', 'page_view', { page_location: location.href, page_path: location.pathname, page_title: document.title });
    this.pixel && window.fbq?.('track', 'PageView');
  }

  private gaItems(items: TrackedItem[]) {
    return items.map((i) => ({
      item_id: String(i.id),
      item_name: i.name,
      item_variant: i.variant,
      item_category: i.category ?? undefined,
      price: i.price,
      quantity: i.quantity ?? 1,
    }));
  }

  private value(items: TrackedItem[]) {
    return items.reduce((s, i) => s + i.price * (i.quantity ?? 1), 0);
  }

  viewItem(item: TrackedItem) {
    this.ga && window.gtag?.('event', 'view_item', { currency: 'UAH', value: item.price, items: this.gaItems([item]) });
    this.pixel && window.fbq?.('track', 'ViewContent', { content_ids: [String(item.id)], content_name: item.name, content_type: 'product', value: item.price, currency: 'UAH' });
  }

  addToCart(item: TrackedItem) {
    const value = this.value([item]);
    this.ga && window.gtag?.('event', 'add_to_cart', { currency: 'UAH', value, items: this.gaItems([item]) });
    this.pixel && window.fbq?.('track', 'AddToCart', { content_ids: [String(item.id)], content_name: item.name, content_type: 'product', value, currency: 'UAH' });
  }

  beginCheckout(items: TrackedItem[]) {
    const value = this.value(items);
    this.ga && window.gtag?.('event', 'begin_checkout', { currency: 'UAH', value, items: this.gaItems(items) });
    this.pixel && window.fbq?.('track', 'InitiateCheckout', { content_ids: items.map((i) => String(i.id)), num_items: items.length, value, currency: 'UAH' });
  }

  purchase(orderNumber: string, total: number, items: TrackedItem[], shipping = 0) {
    // the order page can be reloaded — report each order once per browser
    const key = `amina.tracked.${orderNumber}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
    } catch {
      /* private mode: report anyway */
    }
    this.ga && window.gtag?.('event', 'purchase', { transaction_id: orderNumber, currency: 'UAH', value: total, shipping, items: this.gaItems(items) });
    this.pixel && window.fbq?.('track', 'Purchase', { content_ids: items.map((i) => String(i.id)), content_type: 'product', value: total, currency: 'UAH' }, { eventID: orderNumber });
  }
}
