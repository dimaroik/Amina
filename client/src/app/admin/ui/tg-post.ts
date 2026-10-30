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
            <div class="adm-seg when">
              <button [class.active]="!later()" (click)="later.set(false)">Зараз</button>
              <button [class.active]="later()" (click)="later.set(true)">Запланувати</button>
            </div>
            @if (later()) { <input class="input" type="datetime-local" [(ngModel)]="at" [min]="minAt" /> }
            @if (last(); as l) { <p class="adm-hint" style="margin:0">Востаннє опубліковано {{ l.created_at | date: 'd MMM, HH:mm' }}</p> }
            @for (q of scheduled(); track q.id) {
              <div class="sched small"><app-icon name="clock" [size]="14" /> {{ q.run_at | date: 'EEE d MMM, HH:mm' }}<span class="grow"></span><button class="link small" (click)="cancel(q.id)">Скасувати</button></div>
            }
            <p class="adm-hint" style="margin:0">Фото (або альбом), назва, ціна, опис, розміри й посилання на товар. Спершу збережіть зміни.</p>
            <button class="btn btn-sm" (click)="post()" [disabled]="busy() || (later() && !at)">{{ busy() ? 'Хвилинку…' : later() ? 'Запланувати' : 'Опублікувати в каналі' }}</button>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .wrap { position: relative; }
    .when { display: flex; } .when button { flex: 1; }
    .sched { display: flex; align-items: center; gap: 6px; padding: 6px 8px; background: var(--surface-2); border-radius: var(--radius); }
    .grow { flex: 1; }
    .link { border: 0; background: none; padding: 0; text-decoration: underline; cursor: pointer; color: var(--ink-2); }
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
  protected scheduled = signal<{ id: number; run_at: string }[]>([]);
  protected later = signal(false);
  protected at = '';
  /** datetime-local wants local time without seconds */
  protected minAt = toLocalInput(new Date(Date.now() + 5 * 60_000));

  toggle() {
    this.open.set(!this.open());
    if (!this.open()) return;
    this.load();
  }

  private load() {
    this.api
      .get<{ ready: boolean; last: { created_at: string; kind: string } | null; suggested: Kind; scheduled: { id: number; run_at: string }[] }>(`/products/${this.productId()}/telegram`)
      .subscribe({
        next: (r) => {
          this.ready.set(r.ready);
          this.last.set(r.last);
          this.scheduled.set(r.scheduled ?? []);
          this.kind = r.suggested;
          if (!this.at) this.at = toLocalInput(nextEvening());
        },
        error: (e) => this.toasts.error(errorMessage(e)),
      });
  }

  cancel(id: number) {
    this.api.delete(`/channel/queue/${id}`).subscribe({
      next: () => this.load(),
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }

  post() {
    this.busy.set(true);
    const at = this.later() && this.at ? new Date(this.at).toISOString() : undefined;
    this.api.post<{ messageId?: number; scheduled?: { run_at: string } }>(`/products/${this.productId()}/telegram`, { kind: this.kind, at }).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.open.set(false);
        this.toasts.success(r.scheduled ? `Заплановано на ${new Date(r.scheduled.run_at).toLocaleString('uk-UA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}` : 'Опубліковано в Telegram-каналі');
      },
      error: (e) => {
        this.busy.set(false);
        this.toasts.error(errorMessage(e));
      },
    });
  }
}

function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Today at 19:00, or tomorrow if it is already past — when most people read Telegram. */
function nextEvening(): Date {
  const d = new Date();
  d.setHours(19, 0, 0, 0);
  if (d.getTime() < Date.now() + 5 * 60_000) d.setDate(d.getDate() + 1);
  return d;
}
