import { ChangeDetectionStrategy, Component, inject, input, output, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/api.service';
import { Toasts } from '../../../core/toast.service';
import { AdminApi, type AdminOrder, type AdminSettings } from '../../admin-api';
import { Modal } from '../../ui/modal';
import { NpPicker } from '../../ui/np-picker';

/** Creates a Nova Poshta waybill for an order, prefilled from the order and the store defaults. */
@Component({
  selector: 'adm-ttn-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Modal, NpPicker],
  template: `
    <adm-modal title="Створити ТТН Нової пошти" width="620px" (close)="close.emit()">
      @if (senderMissing()) {
        <p class="warn small">Спершу вкажіть відділення відправки й телефон у <b>Налаштування → Нова пошта</b>.</p>
      }
      <div class="form-grid">
        <div class="field"><label class="label">Прізвище отримувача</label><input class="input" [(ngModel)]="f.lastName" /></div>
        <div class="field"><label class="label">Ім'я</label><input class="input" [(ngModel)]="f.firstName" /></div>
        <div class="field"><label class="label">Телефон</label><input class="input" [(ngModel)]="f.phone" /></div>
        <div class="field"><label class="label">Місто</label>
          <adm-np-picker kind="city" [(name)]="f.cityName" [(ref)]="f.cityRef" (refChange)="f.warehouseRef = ''; f.warehouseName = ''" /></div>
        <div class="field full"><label class="label">Відділення / поштомат</label>
          <adm-np-picker kind="warehouse" [cityRef]="f.cityRef" [(name)]="f.warehouseName" [(ref)]="f.warehouseRef" />
          @if (!f.warehouseRef && f.warehouseName) { <span class="adm-hint">Оберіть відділення зі списку, щоб Нова пошта його розпізнала</span> }</div>
        <div class="field"><label class="label">Вага, кг</label><input class="input" type="number" min="0.1" step="0.1" [(ngModel)]="f.weight" /></div>
        <div class="field"><label class="label">Оголошена вартість, ₴</label><input class="input" type="number" min="1" [(ngModel)]="f.declaredValue" /></div>
        <div class="field"><label class="label">Опис вантажу</label><input class="input" [(ngModel)]="f.description" /></div>
        <div class="field"><label class="label">Доставку оплачує</label>
          <select class="select" [(ngModel)]="f.payer"><option value="Recipient">Отримувач</option><option value="Sender">Відправник (ви)</option></select></div>
        <div class="field full">
          <label class="adm-switch"><input type="checkbox" [(ngModel)]="cod" /><span class="track"></span> Накладений платіж</label>
          @if (cod) {
            <div class="adm-row" style="margin-top:8px"><input class="input" style="max-width:160px" type="number" min="1" [(ngModel)]="f.codAmount" /><span class="adm-hint">₴ — клієнт заплатить при отриманні</span></div>
          }
        </div>
        <label class="adm-switch full"><input type="checkbox" [(ngModel)]="f.markShipped" /><span class="track"></span> Одразу позначити замовлення «Відправлене» і повідомити клієнта</label>
      </div>
      @if (error()) { <p class="err small">{{ error() }}</p> }
      <ng-container foot>
        <button class="btn btn-ghost btn-sm" (click)="close.emit()">Скасувати</button>
        <button class="btn btn-sm" [disabled]="busy() || senderMissing() || !f.cityRef || !f.warehouseRef" (click)="create()">{{ busy() ? 'Створюємо…' : 'Створити ТТН' }}</button>
      </ng-container>
    </adm-modal>
  `,
  styles: `
    .warn { background: #f4efe2; color: var(--warning); padding: 10px 12px; border-radius: 6px; margin: 0 0 14px; }
    .err { color: var(--danger); margin: 12px 0 0; }
    .full { grid-column: 1 / -1; }
  `,
})
export class TtnDialog implements OnInit {
  private api = inject(AdminApi);
  private toasts = inject(Toasts);
  readonly order = input.required<AdminOrder>();
  readonly close = output<void>();
  readonly created = output<AdminOrder>();

  protected busy = signal(false);
  protected error = signal('');
  protected senderMissing = signal(false);
  protected cod = false;
  protected f = {
    firstName: '', lastName: '', phone: '', cityRef: '', cityName: '', warehouseRef: '', warehouseName: '',
    weight: 1, declaredValue: 0, description: 'Одяг', payer: 'Recipient' as 'Recipient' | 'Sender', codAmount: 0, markShipped: true,
  };

  ngOnInit() {
    const o = this.order();
    // "Ім'я Прізвище" is the usual order of a Ukrainian full name in the checkout form
    const parts = o.customer_name.trim().split(/\s+/);
    const unpaid = o.payment_status !== 'paid';
    this.cod = o.payment_method === 'cod' && unpaid;
    this.f = {
      ...this.f,
      firstName: parts[0] ?? '',
      lastName: parts.slice(1).join(' ') || (parts[0] ?? ''),
      phone: o.customer_phone,
      cityRef: o.delivery_city_ref,
      cityName: o.delivery_city,
      warehouseRef: o.delivery_branch_ref,
      warehouseName: o.delivery_branch,
      declaredValue: Math.round(o.total),
      codAmount: Math.round(o.total),
    };
    this.api.get<AdminSettings>('/settings').subscribe((r) => {
      const np = r.settings.novaPoshta;
      this.f.weight = np.defaultWeight;
      this.f.description = np.defaultDescription;
      this.f.payer = np.payer;
      this.senderMissing.set(!np.senderWarehouseRef || !np.senderPhone);
    });
  }

  create() {
    this.busy.set(true);
    this.error.set('');
    const body = { ...this.f, weight: Number(this.f.weight), declaredValue: Number(this.f.declaredValue), codAmount: this.cod ? Number(this.f.codAmount) : 0 };
    this.api.post<{ number: string; cost?: number; order: AdminOrder }>(`/orders/${this.order().id}/ttn`, body).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.toasts.success(`ТТН ${r.number} створено${r.cost ? ` · доставка ≈ ${r.cost} ₴` : ''}`);
        this.created.emit(r.order);
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }
}
