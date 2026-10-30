import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../../../core/api.service';
import type { ProductDetail } from '../../../core/models';
import { Icon } from '../../../shared/icon';

interface AlertResponse {
  ok: boolean;
  emailWorks: boolean;
  telegramLink: string;
}

/** "Notify me when back in stock" dialog for out-of-stock sizes. */
@Component({
  selector: 'app-stock-alert',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon],
  host: { '(document:keydown.escape)': 'close.emit()' },
  template: `
    <div class="wrap" (click)="close.emit()">
      <div class="box" (click)="$event.stopPropagation()" role="dialog" aria-modal="true" aria-label="Повідомити про наявність">
        <button class="icon-btn x" (click)="close.emit()" aria-label="Закрити"><app-icon name="close" /></button>
        @if (!done()) {
          <app-icon name="bell" [size]="28" [stroke]="1.3" />
          <h3 class="h3">Повідомити про наявність</h3>
          <p class="muted small">{{ subtitle() }}. Напишемо одразу, щойно розмір з'явиться.</p>

          @if (options().length > 1) {
            <div class="sizes">
              @for (v of options(); track v.id) {
                <button class="chip" [class.active]="v.id === variantId()" (click)="picked.set(v.id)">{{ v.size || v.color }}</button>
              }
            </div>
          }

          <div class="field">
            <label class="label" for="sa-email">Email</label>
            <input id="sa-email" class="input" type="email" [(ngModel)]="email" placeholder="you@example.com" (keydown.enter)="submit(false)" />
          </div>
          @if (error()) { <p class="err small">{{ error() }}</p> }
          <button class="btn btn-block" [disabled]="busy() || !variantId() || !email.trim()" (click)="submit(false)">Повідомити на email</button>
          <div class="or"><span>або</span></div>
          <button class="btn btn-outline btn-block" [disabled]="busy() || !variantId()" (click)="submit(true)"><app-icon name="telegram" [size]="18" /> Повідомити в Telegram</button>
        } @else {
          <div class="ok"><app-icon name="check" [size]="26" [stroke]="1.8" /></div>
          <h3 class="h3">Готово!</h3>
          <p class="muted small">{{ doneText() }}</p>
          <button class="btn btn-block" (click)="close.emit()">Добре</button>
        }
      </div>
    </div>
  `,
  styles: `
    .wrap { position: fixed; inset: 0; z-index: 300; background: rgba(31,29,26,.4); display: grid; place-items: center; padding: 16px; animation: fade .25s; }
    @keyframes fade { from { opacity: 0; } }
    .box { position: relative; background: var(--bg); width: min(420px, 100%); padding: 32px 24px 24px; display: flex; flex-direction: column; gap: 14px; text-align: center; align-items: center; animation: rise .35s var(--ease); }
    @keyframes rise { from { opacity: 0; transform: translateY(14px); } }
    .x { position: absolute; top: 8px; right: 8px; }
    .h3, p { margin: 0; }
    .sizes { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
    .field { width: 100%; text-align: left; }
    .or { width: 100%; display: flex; align-items: center; gap: 12px; color: var(--muted); font-size: 12px; }
    .or::before, .or::after { content: ''; flex: 1; height: 1px; background: var(--line); }
    .err { color: var(--danger); }
    .ok { width: 56px; height: 56px; border-radius: 50%; background: var(--ink); color: var(--bg); display: grid; place-items: center; }
  `,
})
export class StockAlertDialog {
  private api = inject(Api);
  readonly product = input.required<ProductDetail>();
  readonly color = input('');
  readonly size = input('');
  readonly close = output<void>();

  protected email = '';
  protected busy = signal(false);
  protected error = signal('');
  protected done = signal(false);
  protected doneText = signal('');
  protected picked = signal<number | null>(null);

  protected subtitle = computed(() => [this.product().name, this.color()].filter(Boolean).join(' · '));

  /** Out-of-stock variants of the chosen colour. */
  protected options = computed(() =>
    this.product().variants.filter((v) => v.stock <= 0 && (!this.color() || v.color === this.color())),
  );
  protected variantId = computed(() => {
    const picked = this.picked();
    if (picked && this.options().some((v) => v.id === picked)) return picked;
    return (this.options().find((v) => v.size === this.size()) ?? this.options()[0])?.id ?? null;
  });

  submit(telegram: boolean) {
    const variantId = this.variantId();
    if (!variantId) return;
    // Open the window synchronously so mobile browsers don't block it as a popup
    const win = telegram ? window.open('', '_blank') : null;
    this.busy.set(true);
    this.error.set('');
    this.api.post<AlertResponse>('/stock-alerts', { variantId, email: telegram ? '' : this.email.trim() }).subscribe({
      next: (r) => {
        this.busy.set(false);
        if (telegram) {
          if (!r.telegramLink) {
            win?.close();
            this.error.set('Telegram-сповіщення поки недоступні — залиште email');
            return;
          }
          if (win) win.location.href = r.telegramLink;
          else location.href = r.telegramLink;
          this.doneText.set('Натисніть «Start» у Telegram — і бот повідомить вас, щойно розмір з’явиться.');
        } else {
          this.doneText.set('Ми надішлемо лист, щойно цей розмір знову буде в наявності.');
        }
        this.done.set(true);
      },
      error: (e) => {
        win?.close();
        this.busy.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }
}
