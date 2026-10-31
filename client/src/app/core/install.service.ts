import { Injectable, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { storage } from './storage';

/** Chrome's deferred install offer (not in TypeScript's DOM types yet). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface Window {
    __installPrompt?: InstallPromptEvent;
  }
  interface Navigator {
    standalone?: boolean;
  }
}

const DISMISSED = 'amina.installDismissed';
const VISITS = 'amina.visits';
const ORDERED = 'amina.ordered';
const QUIET_DAYS = 14;

/**
 * «Встановити застосунок»: Android/desktop Chrome get the real install dialog; iPhone has no such
 * dialog, so we show how to add the site to the home screen via Safari's Share menu.
 */
@Injectable({ providedIn: 'root' })
export class Install {
  private offer = signal<InstallPromptEvent | null>(typeof window === 'undefined' ? null : (window.__installPrompt ?? null));
  readonly standalone = signal(
    typeof window !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true),
  );
  readonly ios =
    typeof navigator !== 'undefined' &&
    (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  private touch = typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  /** the «Add to Home Screen» steps for iPhone */
  readonly iosHelp = signal(false);
  private dismissedAt = signal(storage.get<number>(DISMISSED, 0));
  private ordered = signal(storage.get<boolean>(ORDERED, false));
  /** Instagram / Facebook / Telegram in-app browsers cannot install anything */
  private inApp = typeof navigator !== 'undefined' && /Instagram|FBAN|FBAV|FB_IAB|Telegram|Line\//i.test(navigator.userAgent);

  /** a menu item / button makes sense */
  readonly canInstall = computed(() => !this.standalone() && !this.inApp && (!!this.offer() || this.ios));
  /** the unprompted banner: phones only, from the second visit or after an order, not again for two weeks after «Не зараз» */
  readonly suggest = computed(
    () =>
      this.canInstall() &&
      this.touch &&
      Date.now() - this.dismissedAt() > QUIET_DAYS * 86_400_000 &&
      (storage.get<number>(VISITS, 0) >= 2 || this.ordered()),
  );

  constructor() {
    if (typeof window === 'undefined') return;
    // the admin panel installs as its own «AMINA Admin» app; Chrome re-reads the manifest when the link changes
    inject(Router).events.subscribe((e) => {
      if (!(e instanceof NavigationEnd)) return;
      const admin = e.urlAfterRedirects.startsWith('/admin');
      const link = document.querySelector<HTMLLinkElement>('link[rel=manifest]');
      const href = admin ? '/admin.webmanifest' : '/manifest.webmanifest';
      if (link && link.getAttribute('href') !== href) {
        link.setAttribute('href', href);
        document.querySelector<HTMLLinkElement>('link[rel=apple-touch-icon]')?.setAttribute('href', admin ? '/icons/admin-apple.png' : '/icons/icon-apple.png');
        document.querySelector<HTMLMetaElement>('meta[name=apple-mobile-web-app-title]')?.setAttribute('content', admin ? 'AMINA Admin' : 'AMINA');
      }
    });
    addEventListener('amina:installable', () => this.offer.set(window.__installPrompt ?? null));
    addEventListener('appinstalled', () => {
      this.offer.set(null);
      this.standalone.set(true);
    });
    // one visit per browser session
    try {
      if (!sessionStorage.getItem(VISITS)) {
        sessionStorage.setItem(VISITS, '1');
        storage.set(VISITS, storage.get<number>(VISITS, 0) + 1);
      }
    } catch {
      // storage unavailable — the banner just waits for an order
    }
  }

  markOrdered() {
    this.ordered.set(true);
    storage.set(ORDERED, true);
  }

  async install(): Promise<void> {
    const offer = this.offer();
    if (offer) {
      await offer.prompt();
      const { outcome } = await offer.userChoice;
      // Chrome hands out a new offer later if this one was declined
      this.offer.set(null);
      window.__installPrompt = undefined;
      if (outcome === 'dismissed') this.dismiss();
    } else if (this.ios) {
      this.iosHelp.set(true);
    }
  }

  dismiss() {
    this.dismissedAt.set(Date.now());
    storage.set(DISMISSED, Date.now());
  }
}
