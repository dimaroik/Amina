import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import { Install } from '../../core/install.service';

/** A quiet «put AMINA on your phone» card for returning visitors and recent buyers. */
@Component({
  selector: 'app-install-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (show()) {
      <div class="banner" role="dialog" aria-label="Встановити застосунок">
        <img src="/icons/icon-192.png" alt="" width="44" height="44" />
        <div class="txt">
          <b>AMINA на телефоні</b>
          <span>Швидкий доступ з екрана</span>
        </div>
        <button class="go" (click)="install.install()">Встановити</button>
        <button class="x" (click)="install.dismiss()" aria-label="Не зараз">×</button>
      </div>
    }
  `,
  styles: `
    .banner { position: fixed; left: 12px; right: 12px; bottom: calc(84px + env(safe-area-inset-bottom)); z-index: 150; display: flex; align-items: center; gap: 10px;
      padding: 10px 6px 10px 10px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow-lg); animation: up .45s var(--ease); max-width: 460px; }
    /* sits above the chat button */
    img { border-radius: 10px; flex: none; width: 40px; height: 40px; }
    .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.3; }
    .txt b { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .txt span { font-size: 11.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .go { flex: none; border: 0; background: var(--ink); color: var(--bg); padding: 9px 12px; border-radius: 8px; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
    .x { flex: none; border: 0; background: none; font-size: 22px; line-height: 1; color: var(--muted); padding: 4px 6px; cursor: pointer; }
    @keyframes up { from { transform: translateY(140%); } }
  `,
})
export class InstallBanner {
  protected install = inject(Install);
  private ready = signal(false);
  private url = toSignal(
    inject(Router).events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map((e) => (e as NavigationEnd).urlAfterRedirects),
    ),
    { initialValue: inject(Router).url },
  );
  /** not while paying, and not the moment the page opens */
  protected show = computed(() => this.ready() && this.install.suggest() && !/^\/(checkout|cart)/.test(this.url()));

  constructor() {
    const t = setTimeout(() => this.ready.set(true), 6000);
    inject(DestroyRef).onDestroy(() => clearTimeout(t));
  }
}
