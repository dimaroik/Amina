import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Toasts } from '../core/toast.service';
import { Icon } from './icon';

@Component({
  selector: 'app-toasts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="toasts" aria-live="polite">
      @for (t of toasts.items(); track t.id) {
        <div class="toast" [class]="'toast toast-' + t.kind">
          <app-icon [name]="t.kind === 'error' ? 'info' : 'check'" [size]="18" />
          <span class="text">{{ t.text }}</span>
          @if (t.action) {
            <button class="act" (click)="t.action.run(); toasts.dismiss(t.id)">{{ t.action.label }}</button>
          }
          <button class="x" (click)="toasts.dismiss(t.id)" aria-label="Закрити"><app-icon name="close" [size]="14" /></button>
        </div>
      }
    </div>
  `,
  styles: `
    .toasts { position: fixed; z-index: 1000; left: 50%; bottom: 24px; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; width: min(440px, calc(100vw - 32px)); pointer-events: none; }
    .toast { pointer-events: auto; display: flex; align-items: center; gap: 12px; padding: 14px 16px; background: var(--ink); color: var(--bg); box-shadow: var(--shadow-lg); font-size: 14px; animation: in .35s var(--ease); border-radius: var(--radius); }
    .toast-error { background: var(--danger); }
    .toast-success app-icon { color: #b8d1b3; }
    .text { flex: 1; }
    .act { background: none; border: 0; color: inherit; text-decoration: underline; text-underline-offset: 3px; font-size: 13px; padding: 0; }
    .x { background: none; border: 0; color: inherit; opacity: .6; padding: 2px; display: grid; }
    @keyframes in { from { opacity: 0; transform: translateY(12px); } }
  `,
})
export class ToastsHost {
  protected toasts = inject(Toasts);
}
