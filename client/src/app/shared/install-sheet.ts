import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Install } from '../core/install.service';
import { Icon } from './icon';

/** iPhone has no install dialog: how to add the site to the home screen from Safari. */
@Component({
  selector: 'app-install-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { '(document:keydown.escape)': 'install.iosHelp.set(false)' },
  template: `
    @if (install.iosHelp()) {
      <div class="scrim" (click)="install.iosHelp.set(false)"></div>
      <div class="sheet" role="dialog" aria-label="Як встановити застосунок">
        <button class="icon-btn close" (click)="install.iosHelp.set(false)" aria-label="Закрити"><app-icon name="close" /></button>
        <img src="/icons/icon-192.png" alt="" width="64" height="64" class="app-icon" />
        <p class="title">Додайте AMINA на головний екран</p>
        <ol>
          <li><span class="n">1</span><span>Натисніть <b>«Поділитися»</b> <app-icon name="share-ios" [size]="18" /> — внизу екрана Safari (або вгорі, біля адреси)</span></li>
          <li><span class="n">2</span><span>Прогорніть меню й виберіть <b>«На початковий екран»</b> <app-icon name="add-square" [size]="18" /></span></li>
          <li><span class="n">3</span><span>Натисніть <b>«Додати»</b> — іконка з’явиться серед ваших застосунків</span></li>
        </ol>
        <button class="btn btn-block" (click)="install.iosHelp.set(false)">Зрозуміло</button>
      </div>
    }
  `,
  styles: `
    .scrim { position: fixed; inset: 0; background: rgba(31,29,26,.4); z-index: 400; animation: fade .25s; }
    .sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 401; background: var(--bg); padding: 28px 22px calc(22px + env(safe-area-inset-bottom)); border-radius: 18px 18px 0 0; box-shadow: var(--shadow-lg); text-align: center; animation: up .35s var(--ease); max-width: 520px; margin: 0 auto; }
    .close { position: absolute; top: 10px; right: 10px; }
    .app-icon { display: block; margin: 0 auto; border-radius: 15px; box-shadow: 0 6px 18px -6px rgba(31,29,26,.4); }
    .title { font-family: var(--font-serif); font-size: 24px; line-height: 1.2; margin: 14px 0 18px; }
    ol { list-style: none; margin: 0 0 22px; padding: 0; display: flex; flex-direction: column; gap: 14px; text-align: left; font-size: 14px; line-height: 1.5; }
    li { display: flex; align-items: flex-start; gap: 12px; }
    li app-icon { display: inline-flex; vertical-align: -3px; color: #2f7cf6; }
    .n { flex: none; width: 24px; height: 24px; border-radius: 50%; background: var(--surface-2); display: grid; place-items: center; font-size: 12px; font-weight: 600; }
    @keyframes up { from { transform: translateY(100%); } }
    @keyframes fade { from { opacity: 0; } }
  `,
})
export class InstallSheet {
  protected install = inject(Install);
}
