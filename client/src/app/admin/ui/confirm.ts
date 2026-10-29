import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { Modal } from './modal';

interface ConfirmRequest {
  title: string;
  text: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

@Injectable({ providedIn: 'root' })
export class Confirm {
  readonly current = signal<ConfirmRequest | null>(null);

  ask(text: string, opts: { title?: string; confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> {
    return new Promise((resolve) => {
      this.current()?.resolve(false);
      this.current.set({
        text,
        title: opts.title ?? 'Підтвердіть дію',
        confirmLabel: opts.confirmLabel ?? 'Підтвердити',
        danger: opts.danger ?? false,
        resolve,
      });
    });
  }

  answer(ok: boolean) {
    this.current()?.resolve(ok);
    this.current.set(null);
  }
}

@Component({
  selector: 'adm-confirm-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Modal],
  template: `
    @if (confirm.current(); as c) {
      <adm-modal [title]="c.title" width="420px" (close)="confirm.answer(false)">
        <p style="margin:0;line-height:1.6">{{ c.text }}</p>
        <ng-container foot>
          <button class="btn btn-ghost btn-sm" (click)="confirm.answer(false)">Скасувати</button>
          <button class="btn btn-sm" [class.btn-danger]="c.danger" (click)="confirm.answer(true)">{{ c.confirmLabel }}</button>
        </ng-container>
      </adm-modal>
    }
  `,
})
export class ConfirmHost {
  protected confirm = inject(Confirm);
}
