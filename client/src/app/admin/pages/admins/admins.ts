import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/api.service';
import { Auth } from '../../../core/auth.service';
import { Toasts } from '../../../core/toast.service';
import { Icon } from '../../../shared/icon';
import { AdminApi } from '../../admin-api';
import { Confirm } from '../../ui/confirm';

interface AdminUser { id: number; email: string; name: string; created_at: string }

@Component({
  selector: 'app-admin-admins',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, Icon],
  template: `
    <div class="adm-page">
      <div class="adm-page-head"><div><h1>Адміністратори</h1><div class="sub">Хто має доступ до адмінки</div></div></div>
      <div class="adm-split">
        <div class="adm-card">
          <ul class="adm-list" style="padding:0 18px">
            @for (a of items(); track a.id) {
              <li>
                <div class="avatar">{{ (a.name || a.email).charAt(0).toUpperCase() }}</div>
                <div style="flex:1;min-width:0">
                  <div><b>{{ a.name }}</b> @if (a.id === me()) { <span class="adm-pill">це ви</span> }</div>
                  <div class="adm-muted small">{{ a.email }} · з {{ a.created_at | date: 'dd.MM.yyyy' }}</div>
                </div>
                @if (a.id !== me()) {
                  <button class="icon-btn" (click)="remove(a)" title="Забрати доступ"><app-icon name="trash" [size]="16" /></button>
                }
              </li>
            }
          </ul>
        </div>
        <div class="adm-card">
          <div class="adm-card-head"><h3>Додати адміністратора</h3></div>
          <div class="adm-card-body adm-stack" style="gap:12px">
            <div class="field"><label class="label">Ім'я</label><input class="input" [(ngModel)]="form.name" /></div>
            <div class="field"><label class="label">Email</label><input class="input" type="email" [(ngModel)]="form.email" /></div>
            <div class="field"><label class="label">Пароль (від 8 символів)</label><input class="input" type="password" [(ngModel)]="form.password" /></div>
            <p class="adm-hint" style="margin:0">Якщо користувач з таким email уже є, він отримає права адміністратора й новий пароль.</p>
            <button class="btn btn-sm" [disabled]="busy()" (click)="add()">Додати</button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: `.avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--surface-2); display: grid; place-items: center; font-weight: 600; }`,
})
export class AdminsPage {
  private api = inject(AdminApi);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  protected items = signal<AdminUser[]>([]);
  protected busy = signal(false);
  protected form = { name: '', email: '', password: '' };
  private auth = inject(Auth);
  protected me = () => this.auth.user()?.id;

  constructor() {
    this.load();
  }

  load() {
    this.api.get<AdminUser[]>('/admins').subscribe((r) => this.items.set(r));
  }

  add() {
    this.busy.set(true);
    this.api.post('/admins', this.form).subscribe({
      next: () => {
        this.busy.set(false);
        this.form = { name: '', email: '', password: '' };
        this.toasts.success('Адміністратора додано');
        this.load();
      },
      error: (e) => {
        this.busy.set(false);
        this.toasts.error(errorMessage(e));
      },
    });
  }

  async remove(a: AdminUser) {
    if (!(await this.confirm.ask(`Забрати доступ до адмінки в ${a.email}?`, { danger: true, confirmLabel: 'Забрати' }))) return;
    this.api.delete(`/admins/${a.id}`).subscribe({ next: () => this.load(), error: (e) => this.toasts.error(errorMessage(e)) });
  }
}
