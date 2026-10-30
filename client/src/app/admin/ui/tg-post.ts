import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { Toasts } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { AdminApi } from '../admin-api';

type Target = 'telegram' | 'instagram' | 'facebook';
const NAMES: Record<Target, string> = { telegram: 'Telegram', instagram: 'Instagram', facebook: 'Facebook' };

type Kind = 'new' | 'restock' | 'preorder' | 'incoming' | 'sale' | 'plain';
const KINDS: { v: Kind; l: string }[] = [
  { v: 'new', l: '✨ Новинка' },
  { v: 'restock', l: '🔁 Знову в наявності' },
  { v: 'sale', l: '🏷 Знижка' },
  { v: 'preorder', l: '⏳ Передзамовлення' },
  { v: 'incoming', l: '🚚 Уже в дорозі' },
  { v: 'plain', l: 'Без позначки' },
];

/** «Опублікувати» one product to the Telegram channel, Instagram and/or Facebook — now or later. */
@Component({
  selector: 'adm-tg-post',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Icon, DatePipe],
  host: { '(document:keydown.escape)': 'open.set(false)' },
  template: `
    <div class="wrap">
      <button class="btn btn-ghost btn-sm" (click)="toggle()"><app-icon name="send" [size]="15" /> Опублікувати</button>
      @if (open()) {
        <div class="pop adm-card" role="dialog" aria-label="Публікація в Telegram">
          @if (ready() === false && !networks().length) {
            <p class="small" style="margin:0">Ще не підключено ні Telegram-канал, ні Instagram чи Facebook.</p>
            <a class="btn btn-ghost btn-xs" routerLink="/admin/settings" (click)="open.set(false)">Налаштування</a>
          } @else {
            <div class="targets">
              @if (ready()) { <label><input type="checkbox" [checked]="has('telegram')" (change)="flip('telegram')" /> Telegram</label> }
              @for (n of networks(); track n) { <label><input type="checkbox" [checked]="has(n)" (change)="flip(n)" /> {{ n === 'instagram' ? 'Instagram' : 'Facebook' }}</label> }
            </div>
            <div class="field"><label class="label">Позначка в пості</label>
              <select class="select" [(ngModel)]="kind">@for (k of kinds; track k.v) { <option [value]="k.v">{{ k.l }}</option> }</select></div>
            <div class="adm-seg when">
              <button [class.active]="!later()" (click)="later.set(false)">Зараз</button>
              <button [class.active]="later()" (click)="later.set(true)">Запланувати</button>
            </div>
            @if (later()) { <input class="input" type="datetime-local" [(ngModel)]="at" [min]="minAt" /> }
            @if (last(); as l) { <p class="adm-hint" style="margin:0">Востаннє опубліковано {{ l.created_at | date: 'd MMM, HH:mm' }}</p> }
            @for (q of scheduled(); track q.id) {
              <div class="sched small"><app-icon name="clock" [size]="14" /> {{ q.run_at | date: 'EEE d MMM, HH:mm' }}@if (q.target) { · {{ netName(q.target) }} }<span class="grow"></span><button class="link small" (click)="cancel(q.id)">Скасувати</button></div>
            }
            <p class="adm-hint" style="margin:0">Фото (або альбом), назва, ціна, опис, розміри й посилання на товар. Спершу збережіть зміни.</p>
            <button class="btn btn-sm" (click)="post()" [disabled]="busy() || (later() && !at) || !targets().length">{{ busy() ? 'Хвилинку…' : later() ? 'Запланувати' : 'Опублікувати в каналі' }}</button>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .wrap { position: relative; }
    .targets { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 13px; }
    .targets label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
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
  protected scheduled = signal<{ id: number; run_at: string; target?: string }[]>([]);
  protected networks = signal<Target[]>([]);
  protected targets = signal<Target[]>([]);
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
      .get<{ ready: boolean; networks: Target[]; last: { created_at: string; kind: string } | null; suggested: Kind; scheduled: { id: number; run_at: string; target: string }[] }>(
        `/products/${this.productId()}/telegram`,
      )
      .subscribe({
        next: (r) => {
          this.ready.set(r.ready);
          this.networks.set(r.networks ?? []);
          // everything connected is ticked by default
          if (!this.targets().length) this.targets.set([...(r.ready ? (['telegram'] as Target[]) : []), ...(r.networks ?? [])]);
          this.last.set(r.last);
          this.scheduled.set(r.scheduled ?? []);
          this.kind = r.suggested;
          if (!this.at) this.at = toLocalInput(nextEvening());
        },
        error: (e) => this.toasts.error(errorMessage(e)),
      });
  }

  netName(t: string) {
    return NAMES[t as Target] ?? t;
  }

  has(t: Target) {
    return this.targets().includes(t);
  }

  flip(t: Target) {
    this.targets.update((l) => (l.includes(t) ? l.filter((x) => x !== t) : [...l, t]));
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
    this.api
      .post<{ posted?: Target[]; errors?: string[]; scheduled?: { run_at: string } }>(`/products/${this.productId()}/telegram`, { kind: this.kind, at, targets: this.targets() })
      .subscribe({
      next: (r) => {
        this.busy.set(false);
        this.open.set(false);
        if (r.scheduled) {
          this.toasts.success(`Заплановано на ${new Date(r.scheduled.run_at).toLocaleString('uk-UA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`);
          return;
        }
        this.toasts.success(`Опубліковано: ${(r.posted ?? []).map((t) => NAMES[t]).join(', ')}`);
        for (const e of r.errors ?? []) this.toasts.error(e);
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
