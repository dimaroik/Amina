import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import type { ChatMessage } from '../../../core/models';
import { Icon } from '../../../shared/icon';
import { UahPipe } from '../../../shared/uah.pipe';
import { AdminApi, type ChatRow } from '../../admin-api';

interface ChatDetail { id: string; needs_human: boolean; contact: string; transcript: ChatMessage[]; created_at: string; updated_at: string }

@Component({
  selector: 'app-admin-chats',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, Icon, UahPipe],
  template: `
    <div class="adm-page">
      <div class="adm-page-head">
        <div><h1>Звернення в чат</h1><div class="sub">Розмови з чат-ботом. Вгорі — ті, де клієнт просив менеджера</div></div>
        <div class="actions"><a routerLink="/admin/content" class="btn btn-ghost btn-sm">Редагувати FAQ бота</a></div>
      </div>
      <div class="layout" [class.has-detail]="!!id()">
        <div class="adm-card list">
          @for (c of items(); track c.id) {
            <a class="row" [routerLink]="['/admin/chats', c.id]" [class.active]="c.id === id()">
              <div class="adm-between">
                <span class="small"><b>{{ c.contact || 'Відвідувач' }}</b></span>
                <span class="tiny adm-muted">{{ c.updated_at | date: 'dd.MM HH:mm' }}</span>
              </div>
              <div class="preview">{{ c.first_message }}</div>
              <div class="adm-row" style="gap:6px">
                @if (c.needs_human) { <span class="adm-pill warn">Потрібен менеджер</span> }
                <span class="tiny adm-muted">{{ c.messages }} повідомлень</span>
              </div>
            </a>
          } @empty {
            <div class="adm-empty"><app-icon name="chat" [size]="36" /><div class="t">Розмов ще немає</div></div>
          }
        </div>
        <div class="adm-card detail">
          @if (chat(); as c) {
            <div class="adm-card-head">
              <div>
                <a routerLink="/admin/chats" class="adm-back mobile-only"><app-icon name="arrow-left" [size]="14" /> Усі розмови</a>
                <h3>{{ c.contact || 'Відвідувач' }}</h3>
                <div class="tiny adm-muted">Почато {{ c.created_at | date: 'dd.MM.yyyy HH:mm' }}</div>
              </div>
              @if (c.needs_human) {
                <button class="btn btn-sm" (click)="resolve(c)"><app-icon name="check" [size]="15" /> Опрацьовано</button>
              }
            </div>
            <div class="messages">
              @for (m of c.transcript; track $index) {
                <div class="msg" [class.me]="m.role === 'user'">
                  <div class="bubble">{{ m.text }}</div>
                  @if (m.products?.length) {
                    <div class="tiny adm-muted">Показано товари: @for (p of m.products; track p.id) { <span>{{ p.name }} ({{ p.price | uah }}){{ $last ? '' : ', ' }}</span> }</div>
                  }
                  <div class="tiny adm-muted">{{ m.at | date: 'HH:mm' }}</div>
                </div>
              }
            </div>
          } @else {
            <div class="adm-empty">Оберіть розмову зліва</div>
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    .layout { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); }
    @media (min-width: 900px) { .layout { grid-template-columns: 340px minmax(0, 1fr); } .mobile-only { display: none; } }
    @media (max-width: 899px) { .layout.has-detail .list { display: none; } .layout:not(.has-detail) .detail { display: none; } }
    .list { max-height: 75vh; overflow-y: auto; }
    .row { display: flex; flex-direction: column; gap: 4px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
    .row:hover, .row.active { background: var(--surface-2); }
    .preview { font-size: 13px; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .messages { padding: 16px; display: flex; flex-direction: column; gap: 10px; background: #fbfaf7; max-height: 70vh; overflow-y: auto; border-radius: 0 0 10px 10px; }
    .msg { max-width: 80%; display: flex; flex-direction: column; gap: 3px; }
    .msg.me { align-self: flex-end; align-items: flex-end; }
    .bubble { padding: 9px 13px; border-radius: 14px; background: var(--surface); border: 1px solid var(--line); white-space: pre-line; font-size: 13.5px; }
    .me .bubble { background: var(--ink); color: var(--bg); border-color: var(--ink); }
  `,
})
export class ChatsPage {
  private api = inject(AdminApi);
  readonly id = input<string>();
  protected items = signal<ChatRow[]>([]);
  protected chat = signal<ChatDetail | null>(null);

  constructor() {
    this.loadList();
    effect(() => {
      const id = this.id();
      if (!id) return this.chat.set(null);
      this.api.get<ChatDetail>(`/chats/${id}`).subscribe((c) => this.chat.set(c));
    });
  }

  loadList() {
    this.api.get<ChatRow[]>('/chats').subscribe((r) => this.items.set(r));
  }

  resolve(c: ChatDetail) {
    this.api.patch(`/chats/${c.id}`, { needs_human: false }).subscribe(() => {
      this.chat.set({ ...c, needs_human: false });
      this.loadList();
      this.api.refreshBadges();
    });
  }
}
