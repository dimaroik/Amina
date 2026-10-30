import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { Toasts } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { AdminApi } from '../admin-api';

type Kind = 'new' | 'restock' | 'preorder' | 'incoming' | 'sale' | 'plain';
const KINDS: { v: Kind; l: string }[] = [
  { v: 'new', l: '✨ Новинка' },
  { v: 'restock', l: '🔁 Знову в наявності' },
  { v: 'sale', l: '🏷 Знижка' },
  { v: 'preorder', l: '⏳ Передзамовлення' },
  { v: 'incoming', l: '🚚 Уже в дорозі' },
  { v: 'plain', l: 'Без позначки' },
];

/** «Опублікувати в Telegram-каналі» for one product. */
@Component({
  selector: 'adm-tg-post',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Icon, DatePipe],
  host: { '(document:keydown.escape)': 'open.set(false)' },
  template: `
    <div class="wrap">
      <button class="btn btn-ghost btn-sm" (click)="toggle()"><app-icon name="telegram" [size]="15" /> Telegram</button>
      @if (open()) {
        <div class="pop adm-card" role="dialog" aria-label="Публікація в Telegram">
          @if (ready() === false) {
            <p class="small" style="margin:0">Канал ще не підключено.</p>
            <a class="btn btn-ghost btn-xs" routerLink="/admin/settings" (click)="open.set(false)">Налаштування → Telegram</a>
          } @else {
            <div class="field"><label class="label">Позначка в пості</label>
              <select class="select" [(ngModel)]="kind">@for (k of kinds; track k.v) { <option [value]="k.v">{{ k.l }}</option> }</select></div>
            @if (last(); as l) { <p class="adm-hint" style="margin:0">Востаннє опубліковано {{ l.created_at | date: 'd MMM, HH:mm' }}</p> }
            <p class="adm-hint" style="margin:0">Фото, назва, ціна, опис, розміри й кнопка на сторінку товару. Спершу збережіть зміни.</p>
            <button class="btn btn-sm" (click)="post()" [disabled]="busy()">{{ busy() ? 'Публікуємо…' : 'Опублікувати в каналі' }}</button>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .wrap { position: relative; }
    .pop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 30; width: 280px; padding: 14px; display: flex; flex-direction: column; gap: 10px; box-shadow: var(--shadow); }
  `,
})
export class TgPost {
  private api = inject(AdminApi);
  private toasts = inject(Toasts);
  readonly productId = input.required<number>();
  protected kinds = KINDS;
  protected kind: Kind = 'new';
  protected open = signal(false);
  protected busy = signal(false);
  protected ready = signal<boolean | null>(null);
  protected last = signal<{ created_at: string; kind: string } | null>(null);

  toggle() {
    this.open.set(!this.open());
    if (!this.open()) return;
    this.api.get<{ ready: boolean; last: { created_at: string; kind: string } | null; suggested: Kind }>(`/products/${this.productId()}/telegram`).subscribe({
      next: (r) => {
        this.ready.set(r.ready);
        this.last.set(r.last);
        this.kind = r.suggested;
      },
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }

  post() {
    this.busy.set(true);
    this.api.post<{ messageId: number }>(`/products/${this.productId()}/telegram`, { kind: this.kind }).subscribe({
      next: () => {
        this.busy.set(false);
        this.open.set(false);
        this.toasts.success('Опубліковано в Telegram-каналі');
      },
      error: (e) => {
        this.busy.set(false);
        this.toasts.error(errorMessage(e));
      },
    });
  }
}
