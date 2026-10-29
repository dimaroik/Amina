import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../../core/api.service';
import { DELIVERY_TYPE_LABELS, PAYMENT_CODE_LABELS } from '../../../core/labels';
import type { DeliveryMethod, DeliveryType, PaymentCode, PaymentMethod } from '../../../core/models';
import { Toasts } from '../../../core/toast.service';
import { Icon } from '../../../shared/icon';
import { UahPipe } from '../../../shared/uah.pipe';
import { AdminApi } from '../../admin-api';
import { Confirm } from '../../ui/confirm';
import { Modal } from '../../ui/modal';

type DeliveryDraft = Omit<DeliveryMethod, 'id'> & { id?: number };
type PaymentDraft = Omit<PaymentMethod, 'id'> & { id?: number };

const PAYMENT_HINTS: Record<PaymentCode, string> = {
  mono_jar: 'Клієнт бачить QR-код і посилання на банку з сумою. Посилання на банку — в Налаштуваннях → Оплата.',
  mono_acquiring: 'Оплата карткою, Apple Pay, Google Pay. Потрібна змінна MONOBANK_TOKEN на Render. Статус «оплачено» ставиться автоматично.',
  iban: 'Клієнт бачить реквізити для переказу. Заповніть IBAN у Налаштуваннях → Оплата.',
  cod: 'Оплата при отриманні у відділенні.',
};

@Component({
  selector: 'app-admin-delivery-payment',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Icon, UahPipe, Modal],
  template: `
    <div class="adm-page">
      <div class="adm-page-head"><div><h1>Доставка й оплата</h1><div class="sub">Що бачить клієнт під час оформлення замовлення</div></div></div>
      <div class="adm-grid adm-grid-2">
        <div class="adm-card">
          <div class="adm-card-head"><h3>Способи доставки</h3><button class="btn btn-sm" (click)="editDelivery(null)"><app-icon name="plus" [size]="14" /> Додати</button></div>
          <ul class="adm-list" style="padding:0 18px">
            @for (d of delivery(); track d.id) {
              <li class="clickable" (click)="editDelivery(d)">
                <span class="adm-dot" [class.on]="d.is_active"></span>
                <div style="flex:1;min-width:0">
                  <b>{{ d.name }}</b>
                  <div class="small adm-muted">{{ typeLabels[d.type] }} · {{ d.price > 0 ? (d.price | uah) : 'за тарифами перевізника' }}@if (d.free_from) { · безкоштовно від {{ d.free_from | uah }} }</div>
                </div>
                <app-icon name="chevron-right" [size]="16" />
              </li>
            }
          </ul>
        </div>
        <div class="adm-card">
          <div class="adm-card-head"><h3>Способи оплати</h3><button class="btn btn-sm" (click)="editPayment(null)"><app-icon name="plus" [size]="14" /> Додати</button></div>
          <ul class="adm-list" style="padding:0 18px">
            @for (p of payments(); track p.id) {
              <li class="clickable" (click)="editPayment(p)">
                <span class="adm-dot" [class.on]="p.is_active"></span>
                <div style="flex:1;min-width:0"><b>{{ p.name }}</b><div class="small adm-muted">{{ codeLabels[p.code] }}</div></div>
                <app-icon name="chevron-right" [size]="16" />
              </li>
            }
          </ul>
          <p class="adm-hint" style="padding:0 18px 14px;margin:0">Спосіб оплати без налаштувань (немає посилання на банку, IBAN чи токена monobank) клієнтам не показується. <a routerLink="/admin/settings" class="link-plain">Налаштування оплати →</a></p>
        </div>
      </div>
    </div>

    @if (d(); as d) {
      <adm-modal [title]="d.id ? 'Спосіб доставки' : 'Новий спосіб доставки'" (close)="this.d.set(null)">
        <div class="form-grid">
          <div class="field full"><label class="label">Назва для клієнта</label><input class="input" [(ngModel)]="d.name" /></div>
          <div class="field full"><label class="label">Тип (які поля питати в клієнта)</label>
            <select class="select" [(ngModel)]="d.type">@for (t of types; track t) { <option [value]="t">{{ typeLabels[t] }}</option> }</select></div>
          <div class="field full"><label class="label">Опис</label><input class="input" [(ngModel)]="d.description" /></div>
          <div class="field"><label class="label">Вартість, ₴ (0 — за тарифами перевізника)</label><input class="input" type="number" min="0" [(ngModel)]="d.price" /></div>
          <div class="field"><label class="label">Безкоштовно від, ₴</label><input class="input" type="number" min="0" [(ngModel)]="d.free_from" placeholder="не діє" /></div>
          <div class="field"><label class="label">Порядок</label><input class="input" type="number" [(ngModel)]="d.sort_order" /></div>
          <div class="field" style="justify-content:flex-end"><label class="adm-switch"><input type="checkbox" [(ngModel)]="d.is_active" /><span class="track"></span> Активний</label></div>
        </div>
        <ng-container foot>
          @if (d.id) { <button class="btn btn-ghost btn-sm" style="margin-right:auto;color:var(--danger)" (click)="removeDelivery(d)">Видалити</button> }
          <button class="btn btn-ghost btn-sm" (click)="this.d.set(null)">Скасувати</button>
          <button class="btn btn-sm" (click)="saveDelivery(d)">Зберегти</button>
        </ng-container>
      </adm-modal>
    }

    @if (p(); as p) {
      <adm-modal [title]="p.id ? 'Спосіб оплати' : 'Новий спосіб оплати'" (close)="this.p.set(null)">
        <div class="form-grid">
          <div class="field full"><label class="label">Тип</label>
            <select class="select" [(ngModel)]="p.code">@for (c of codes; track c) { <option [value]="c">{{ codeLabels[c] }}</option> }</select>
            <div class="adm-hint">{{ hints[p.code] }}</div></div>
          <div class="field full"><label class="label">Назва для клієнта</label><input class="input" [(ngModel)]="p.name" /></div>
          <div class="field full"><label class="label">Опис</label><input class="input" [(ngModel)]="p.description" /></div>
          <div class="field"><label class="label">Порядок</label><input class="input" type="number" [(ngModel)]="p.sort_order" /></div>
          <div class="field" style="justify-content:flex-end"><label class="adm-switch"><input type="checkbox" [(ngModel)]="p.is_active" /><span class="track"></span> Активний</label></div>
        </div>
        <ng-container foot>
          @if (p.id) { <button class="btn btn-ghost btn-sm" style="margin-right:auto;color:var(--danger)" (click)="removePayment(p)">Видалити</button> }
          <button class="btn btn-ghost btn-sm" (click)="this.p.set(null)">Скасувати</button>
          <button class="btn btn-sm" (click)="savePayment(p)">Зберегти</button>
        </ng-container>
      </adm-modal>
    }
  `,
  styles: `li.clickable { cursor: pointer; } li.clickable:hover b { text-decoration: underline; }`,
})
export class DeliveryPaymentPage {
  private api = inject(AdminApi);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  protected typeLabels = DELIVERY_TYPE_LABELS;
  protected codeLabels = PAYMENT_CODE_LABELS;
  protected hints = PAYMENT_HINTS;
  protected types = Object.keys(DELIVERY_TYPE_LABELS) as DeliveryType[];
  protected codes = Object.keys(PAYMENT_CODE_LABELS) as PaymentCode[];
  protected delivery = signal<DeliveryMethod[]>([]);
  protected payments = signal<PaymentMethod[]>([]);
  protected d = signal<DeliveryDraft | null>(null);
  protected p = signal<PaymentDraft | null>(null);

  constructor() {
    this.load();
  }

  load() {
    this.api.get<DeliveryMethod[]>('/delivery-methods').subscribe((r) => this.delivery.set(r));
    this.api.get<PaymentMethod[]>('/payment-methods').subscribe((r) => this.payments.set(r));
  }

  private after = {
    next: () => {
      this.toasts.success('Збережено');
      this.d.set(null);
      this.p.set(null);
      this.load();
    },
    error: (e: unknown) => this.toasts.error(errorMessage(e)),
  };

  editDelivery(x: DeliveryMethod | null) {
    this.d.set(x ? { ...x } : { name: '', description: '', type: 'np_warehouse', price: 0, free_from: null, is_active: true, sort_order: this.delivery().length + 1 });
  }
  saveDelivery(x: DeliveryDraft) {
    const { id, ...b } = x;
    const body = { ...b, price: Number(b.price) || 0, free_from: b.free_from === null || (b.free_from as unknown) === '' ? null : Number(b.free_from), sort_order: Number(b.sort_order) || 0 };
    (id ? this.api.put(`/delivery-methods/${id}`, body) : this.api.post('/delivery-methods', body)).subscribe(this.after);
  }
  async removeDelivery(x: DeliveryDraft) {
    if (await this.confirm.ask(`Видалити «${x.name}»? Можна просто вимкнути.`, { danger: true, confirmLabel: 'Видалити' })) this.api.delete(`/delivery-methods/${x.id}`).subscribe(this.after);
  }

  editPayment(x: PaymentMethod | null) {
    this.p.set(x ? { ...x } : { code: 'cod', name: '', description: '', is_active: true, sort_order: this.payments().length + 1 });
  }
  savePayment(x: PaymentDraft) {
    const { id, ...b } = x;
    const body = { ...b, sort_order: Number(b.sort_order) || 0 };
    (id ? this.api.put(`/payment-methods/${id}`, body) : this.api.post('/payment-methods', body)).subscribe(this.after);
  }
  async removePayment(x: PaymentDraft) {
    if (await this.confirm.ask(`Видалити «${x.name}»?`, { danger: true, confirmLabel: 'Видалити' })) this.api.delete(`/payment-methods/${x.id}`).subscribe(this.after);
  }
}
