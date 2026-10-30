import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/api.service';
import { Toasts } from '../../../core/toast.service';
import { Icon } from '../../../shared/icon';
import { Stars } from '../../../shared/stars';
import { AdminApi, type AdminReview } from '../../admin-api';
import { Confirm } from '../../ui/confirm';

type Status = AdminReview['status'];
const FIT = { small: 'Маломірить', true: 'В розмір', large: 'Великомірить' } as const;

@Component({
  selector: 'app-admin-reviews',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, Icon, Stars],
  template: `
    <div class="adm-page">
      <div class="adm-page-head">
        <div><h1>Відгуки</h1><div class="sub">Нові відгуки з'являються на сайті лише після схвалення</div></div>
      </div>
      <div class="adm-tabs">
        @for (t of tabs; track t.v) {
          <button [class.active]="status() === t.v" (click)="load(t.v)">{{ t.l }} @if (counts()[t.v]) { <span class="count">{{ counts()[t.v] }}</span> }</button>
        }
      </div>

      <div class="list">
        @for (r of items(); track r.id) {
          <div class="adm-card review">
            <div class="top">
              <a class="prod" [href]="'/product/' + r.product_slug" target="_blank">
                @if (r.product_image) { <img [src]="r.product_image" class="adm-thumb-sm" alt="" /> }
                <span class="small">{{ r.product_name }}</span>
              </a>
              <span class="tiny adm-muted">{{ r.created_at | date: 'dd.MM.yyyy HH:mm' }}</span>
            </div>
            <div class="who">
              <b>{{ r.name }}</b>
              <app-stars [value]="r.rating" />
              @if (r.verified) { <span class="adm-pill ok">Перевірена покупка</span> }
            </div>
            @if (r.size || r.height || r.fit) {
              <div class="tiny adm-muted meta">
                @if (r.size) { <span>Розмір {{ r.size }}</span> } @if (r.height) { <span>Зріст {{ r.height }} см</span> } @if (r.fit) { <span>{{ fit[r.fit] }}</span> }
              </div>
            }
            <p class="text">{{ r.text }}</p>
            @if (r.photos.length) {
              <div class="photos">@for (p of r.photos; track $index) { <a [href]="p" target="_blank"><img [src]="p" alt="" /></a> }</div>
            }
            @if (replyFor() === r.id) {
              <div class="reply-edit">
                <textarea class="textarea" rows="3" [(ngModel)]="replyText" placeholder="Відповідь від магазину (буде видно під відгуком)"></textarea>
                <div class="adm-row">
                  <button class="btn btn-sm" (click)="saveReply(r)">Зберегти відповідь</button>
                  <button class="btn btn-ghost btn-sm" (click)="replyFor.set(null)">Скасувати</button>
                </div>
              </div>
            } @else if (r.admin_reply) {
              <div class="reply"><span class="tiny adm-muted">Ваша відповідь</span><p>{{ r.admin_reply }}</p></div>
            }
            <div class="actions">
              @if (r.status !== 'approved') { <button class="btn btn-sm" (click)="setStatus(r, 'approved')"><app-icon name="check" [size]="14" /> Опублікувати</button> }
              @if (r.status !== 'rejected') { <button class="btn btn-ghost btn-sm" (click)="setStatus(r, 'rejected')">Відхилити</button> }
              @if (r.status === 'rejected') { <button class="btn btn-ghost btn-sm" (click)="setStatus(r, 'pending')">На модерацію</button> }
              <button class="btn btn-ghost btn-sm" (click)="startReply(r)"><app-icon name="chat" [size]="14" /> {{ r.admin_reply ? 'Змінити відповідь' : 'Відповісти' }}</button>
              <span class="spacer"></span>
              <button class="icon-btn" (click)="remove(r)" title="Видалити"><app-icon name="trash" [size]="16" /></button>
            </div>
          </div>
        } @empty {
          <div class="adm-card adm-empty"><app-icon name="star" [size]="36" /><div class="t">{{ emptyText[status()] }}</div></div>
        }
      </div>
    </div>
  `,
  styles: `
    .list { display: flex; flex-direction: column; gap: 12px; }
    .review { padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; }
    .top { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .prod { display: flex; align-items: center; gap: 10px; color: var(--ink-2); }
    .prod:hover span { text-decoration: underline; }
    .who { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .meta { display: flex; gap: 12px; flex-wrap: wrap; }
    .text { margin: 0; line-height: 1.6; white-space: pre-line; }
    .photos { display: flex; gap: 8px; flex-wrap: wrap; }
    .photos img { width: 76px; height: 96px; object-fit: cover; border-radius: 4px; }
    .reply { background: var(--surface-2); border-radius: 6px; padding: 10px 12px; }
    .reply p { margin: 4px 0 0; }
    .reply-edit { display: flex; flex-direction: column; gap: 8px; }
    .actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; border-top: 1px solid var(--line); padding-top: 10px; }
    .spacer { flex: 1; }
  `,
})
export class ReviewsPage {
  private api = inject(AdminApi);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  protected fit = FIT;
  protected tabs: { v: Status; l: string }[] = [
    { v: 'pending', l: 'На модерації' },
    { v: 'approved', l: 'Опубліковані' },
    { v: 'rejected', l: 'Відхилені' },
  ];
  protected emptyText: Record<Status, string> = {
    pending: 'Нових відгуків немає',
    approved: 'Опублікованих відгуків поки немає',
    rejected: 'Відхилених відгуків немає',
  };
  protected status = signal<Status>('pending');
  protected items = signal<AdminReview[]>([]);
  protected counts = signal<Record<string, number>>({});
  protected replyFor = signal<number | null>(null);
  protected replyText = '';

  constructor() {
    this.load('pending');
  }

  load(status: Status) {
    this.status.set(status);
    this.api.get<{ items: AdminReview[]; counts: Record<string, number> }>('/reviews', { status }).subscribe((r) => {
      this.items.set(r.items);
      this.counts.set(r.counts);
      this.api.pendingReviews.set(r.counts['pending'] ?? 0);
    });
  }

  setStatus(r: AdminReview, status: Status) {
    this.api.patch(`/reviews/${r.id}`, { status }).subscribe({
      next: () => {
        this.toasts.success(status === 'approved' ? 'Відгук опубліковано' : status === 'rejected' ? 'Відгук відхилено' : 'Повернуто на модерацію');
        this.load(this.status());
      },
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }

  startReply(r: AdminReview) {
    this.replyText = r.admin_reply;
    this.replyFor.set(r.id);
  }

  saveReply(r: AdminReview) {
    this.api.patch<AdminReview>(`/reviews/${r.id}`, { admin_reply: this.replyText }).subscribe({
      next: () => {
        this.replyFor.set(null);
        this.toasts.success('Відповідь збережено');
        this.load(this.status());
      },
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }

  async remove(r: AdminReview) {
    if (!(await this.confirm.ask('Видалити відгук назавжди?', { danger: true, confirmLabel: 'Видалити' }))) return;
    this.api.delete(`/reviews/${r.id}`).subscribe(() => this.load(this.status()));
  }
}
