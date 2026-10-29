import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/api.service';
import { Toasts } from '../../../core/toast.service';
import { Icon } from '../../../shared/icon';
import { UahPipe } from '../../../shared/uah.pipe';
import { AdminApi, type PromoCode } from '../../admin-api';
import { Confirm } from '../../ui/confirm';
import { Modal } from '../../ui/modal';

const empty = (): PromoCode => ({ code: '', type: 'percent', value: 10, min_total: 0, max_uses: null, expires_at: null, is_active: true });

@Component({
  selector: 'app-admin-promo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, Icon, UahPipe, Modal],
  template: `
    <div class="adm-page">
      <div class="adm-page-head">
        <div><h1>Промокоди</h1><div class="sub">Знижки для клієнтів: відсоток або фіксована сума</div></div>
        <div class="actions"><button class="btn btn-sm" (click)="edit(null)"><app-icon name="plus" [size]="15" /> Новий промокод</button></div>
      </div>
      <div class="adm-card">
        @if (items().length) {
          <div class="adm-table-wrap">
            <table class="adm-table">
              <thead><tr><th>Код</th><th>Знижка</th><th class="num">Від суми</th><th class="num">Використано</th><th>Діє до</th><th>Статус</th><th></th></tr></thead>
              <tbody>
                @for (p of items(); track p.id) {
                  <tr class="clickable" (click)="edit(p)">
                    <td class="primary"><b>{{ p.code }}</b></td>
                    <td data-label="Знижка">{{ p.type === 'percent' ? p.value + '%' : (p.value | uah) }}</td>
                    <td class="num" data-label="Від суми">{{ p.min_total ? (p.min_total | uah) : '—' }}</td>
                    <td class="num" data-label="Використано">{{ p.used_count }}{{ p.max_uses ? ' / ' + p.max_uses : '' }}</td>
                    <td data-label="Діє до">{{ p.expires_at ? (p.expires_at | date: 'dd.MM.yyyy') : 'безстроково' }}</td>
                    <td data-label="Статус"><span class="adm-pill" [class.ok]="p.is_active">{{ p.is_active ? 'Активний' : 'Вимкнено' }}</span></td>
                    <td class="nowrap" (click)="$event.stopPropagation()">
                      <button class="icon-btn" (click)="remove(p)" title="Видалити"><app-icon name="trash" [size]="16" /></button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <div class="adm-empty"><app-icon name="tag" [size]="36" /><div class="t">Промокодів ще немає</div><div>Створіть, наприклад, WELCOME10 для нових клієнтів</div></div>
        }
      </div>
    </div>

    @if (draft(); as d) {
      <adm-modal [title]="d.id ? 'Редагувати промокод' : 'Новий промокод'" (close)="draft.set(null)">
        <div class="form-grid">
          <div class="field full"><label class="label">Код</label><input class="input" [(ngModel)]="d.code" placeholder="SUMMER20" style="text-transform:uppercase" /></div>
          <div class="field"><label class="label">Тип</label>
            <select class="select" [(ngModel)]="d.type"><option value="percent">Відсоток, %</option><option value="fixed">Фіксована сума, ₴</option></select></div>
          <div class="field"><label class="label">Розмір знижки</label><input class="input" type="number" min="0" [(ngModel)]="d.value" /></div>
          <div class="field"><label class="label">Мінімальна сума замовлення, ₴</label><input class="input" type="number" min="0" [(ngModel)]="d.min_total" /></div>
          <div class="field"><label class="label">Ліміт використань</label><input class="input" type="number" min="1" [(ngModel)]="d.max_uses" placeholder="без ліміту" /></div>
          <div class="field"><label class="label">Діє до</label><input class="input" type="date" [ngModel]="d.expires_at?.slice(0, 10)" (ngModelChange)="d.expires_at = $event || null" /></div>
          <div class="field" style="justify-content:flex-end"><label class="adm-switch"><input type="checkbox" [(ngModel)]="d.is_active" /><span class="track"></span> Активний</label></div>
        </div>
        <ng-container foot>
          <button class="btn btn-ghost btn-sm" (click)="draft.set(null)">Скасувати</button>
          <button class="btn btn-sm" [disabled]="busy()" (click)="save(d)">Зберегти</button>
        </ng-container>
      </adm-modal>
    }
  `,
})
export class PromoPage {
  private api = inject(AdminApi);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  protected items = signal<PromoCode[]>([]);
  protected draft = signal<PromoCode | null>(null);
  protected busy = signal(false);

  constructor() {
    this.load();
  }

  load() {
    this.api.get<PromoCode[]>('/promo-codes').subscribe((r) => this.items.set(r));
  }

  edit(p: PromoCode | null) {
    this.draft.set(p ? { ...p } : empty());
  }

  save(d: PromoCode) {
    this.busy.set(true);
    const body = { ...d, code: d.code.trim().toUpperCase(), value: Number(d.value), min_total: Number(d.min_total) || 0, max_uses: d.max_uses ? Number(d.max_uses) : null };
    const req = d.id ? this.api.put(`/promo-codes/${d.id}`, body) : this.api.post('/promo-codes', body);
    req.subscribe({
      next: () => {
        this.busy.set(false);
        this.draft.set(null);
        this.toasts.success('Промокод збережено');
        this.load();
      },
      error: (e) => {
        this.busy.set(false);
        this.toasts.error(errorMessage(e));
      },
    });
  }

  async remove(p: PromoCode) {
    if (!(await this.confirm.ask(`Видалити промокод ${p.code}?`, { danger: true, confirmLabel: 'Видалити' }))) return;
    this.api.delete(`/promo-codes/${p.id}`).subscribe(() => this.load());
  }
}
