import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../../core/api.service';
import { ORDER_PROGRESS, ORDER_STATUSES, ORDER_STATUS_LABELS, PAYMENT_STATUSES, PAYMENT_STATUS_LABELS } from '../../../core/labels';
import type { OrderStatus, PaymentStatus } from '../../../core/models';
import { Toasts } from '../../../core/toast.service';
import { Icon } from '../../../shared/icon';
import { EtaPipe } from '../../../shared/eta.pipe';
import { UahPipe } from '../../../shared/uah.pipe';
import { AdminApi, phoneDigits, type AdminOrder, type VariantSearchRow } from '../../admin-api';
import { TtnDialog } from './ttn-dialog';
import { Confirm } from '../../ui/confirm';

interface EditItem {
  id?: number;
  variant_id: number | null;
  name: string;
  size: string;
  color: string;
  image_url: string | null;
  price: number;
  quantity: number;
}

const COD_LABELS: Record<string, string> = { awaiting: 'посилка в дорозі', collected: 'клієнт оплатив, гроші йдуть', paid_out: 'гроші отримано', refused: 'посилку не забрали' };
const CHANNEL_LABELS: Record<string, string> = { phone: 'Дзвінок', telegram: 'Telegram', viber: 'Viber', whatsapp: 'WhatsApp', email: 'Email' };
const HISTORY_ICONS: Record<string, string> = { created: 'sparkle', status: 'refresh', payment: 'card', tracking: 'truck', items: 'box', message: 'chat', edit: 'edit', telegram_linked: 'telegram', viber_linked: 'viber', payment_error: 'info', preorder: 'parcel' };

@Component({
  selector: 'app-admin-order-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Icon, UahPipe, EtaPipe, DatePipe, TtnDialog],
  templateUrl: './order-detail.html',
  styleUrl: './order-detail.scss',
})
export class OrderDetailPage {
  readonly id = input.required<string>();
  private api = inject(AdminApi);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  private router = inject(Router);

  protected statuses = ORDER_STATUSES;
  protected paymentStatuses = PAYMENT_STATUSES;
  protected statusLabels = ORDER_STATUS_LABELS;
  protected paymentLabels = PAYMENT_STATUS_LABELS;
  protected channelLabels = CHANNEL_LABELS;
  protected historyIcons = HISTORY_ICONS;
  protected codLabels = COD_LABELS;
  protected progress = [...ORDER_PROGRESS, 'completed'] as OrderStatus[];

  protected order = signal<AdminOrder | null>(null);
  protected busy = signal(false);
  protected ttnOpen = signal(false);
  protected notify = signal(true);
  protected statusNote = '';

  // editable blocks
  protected editCustomer = signal(false);
  protected customer = { customer_name: '', customer_phone: '', customer_email: '' };
  protected delivery = { delivery_city: '', delivery_branch: '', delivery_address: '', tracking_number: '' };
  protected adminNote = '';
  protected money = { discount: 0, delivery_cost: 0 };
  protected message = '';

  // items editor
  protected editItems = signal(false);
  protected items = signal<EditItem[]>([]);
  protected variantQuery = '';
  protected variantResults = signal<VariantSearchRow[]>([]);
  private searchTimer?: ReturnType<typeof setTimeout>;

  protected stepIndex = computed(() => this.progress.indexOf(this.order()?.status ?? 'new'));
  protected nextStatus = computed<OrderStatus | null>(() => {
    const i = this.stepIndex();
    return i >= 0 && i < this.progress.length - 1 ? this.progress[i + 1] : null;
  });
  protected itemsTotal = computed(() => this.items().reduce((s, i) => s + i.price * i.quantity, 0));
  protected phone = computed(() => phoneDigits(this.order()?.customer_phone ?? ''));
  protected npTracking = computed(() => {
    const t = this.order()?.tracking_number;
    return t ? `https://novaposhta.ua/tracking/?cargo_number=${encodeURIComponent(t)}` : '';
  });

  ngOnInit() {
    this.load();
  }

  load() {
    this.api.get<AdminOrder>(`/orders/${this.id()}`).subscribe({
      next: (o) => this.apply(o),
      error: (e) => {
        this.toasts.error(errorMessage(e));
        this.router.navigateByUrl('/admin/orders');
      },
    });
  }

  private apply(o: AdminOrder) {
    // PATCH/PUT return the order without history; keep the old one until reload
    const prev = this.order();
    this.order.set({ ...o, history: o.history ?? prev?.history, notifications: o.notifications ?? prev?.notifications, customerStats: o.customerStats ?? prev?.customerStats });
    this.customer = { customer_name: o.customer_name, customer_phone: o.customer_phone, customer_email: o.customer_email };
    this.delivery = { delivery_city: o.delivery_city, delivery_branch: o.delivery_branch, delivery_address: o.delivery_address, tracking_number: o.tracking_number };
    this.adminNote = o.admin_note;
    this.money = { discount: o.discount, delivery_cost: o.delivery_cost };
    this.items.set(o.items.map((i) => ({ ...i })));
    if (!this.message) this.message = this.defaultMessage(o);
  }

  private defaultMessage(o: AdminOrder): string {
    const first = o.customer_name.split(' ')[0];
    return `Вітаємо, ${first}! Ваше замовлення ${o.number} в Amina: ${ORDER_STATUS_LABELS[o.status].toLowerCase()}.${o.tracking_number ? ` ТТН: ${o.tracking_number}` : ''}`;
  }

  private patch(body: Record<string, unknown>, okText: string) {
    this.busy.set(true);
    this.api.patch<AdminOrder>(`/orders/${this.id()}`, body).subscribe({
      next: () => {
        this.busy.set(false);
        this.toasts.success(okText);
        this.load();
        this.api.refreshBadges();
      },
      error: (e) => {
        this.busy.set(false);
        this.toasts.error(errorMessage(e));
      },
    });
  }

  setStatus(status: OrderStatus) {
    if (status === this.order()?.status) return;
    this.patch({ status, notify: this.notify(), note: this.statusNote }, `Статус: ${ORDER_STATUS_LABELS[status]}${this.notify() ? ' · клієнта сповіщено' : ''}`);
    this.statusNote = '';
  }

  async cancelOrder() {
    if (await this.confirm.ask('Скасувати замовлення? Товари повернуться на склад.', { confirmLabel: 'Скасувати замовлення', danger: true })) {
      this.setStatus('cancelled');
    }
  }

  setPayment(payment_status: PaymentStatus) {
    this.patch({ payment_status, notify: this.notify() }, `Оплата: ${PAYMENT_STATUS_LABELS[payment_status]}`);
  }

  saveCustomer() {
    this.patch({ ...this.customer, notify: false }, 'Дані клієнта збережено');
    this.editCustomer.set(false);
  }

  saveDelivery() {
    this.patch({ ...this.delivery, notify: false }, 'Доставку оновлено');
  }

  saveNote() {
    this.patch({ admin_note: this.adminNote, notify: false }, 'Нотатку збережено');
  }

  saveMoney() {
    this.patch({ discount: Number(this.money.discount) || 0, delivery_cost: Number(this.money.delivery_cost) || 0, notify: false }, 'Суми оновлено');
  }

  sendMessage() {
    const message = this.message.trim();
    if (!message) return;
    this.busy.set(true);
    this.api.post(`/orders/${this.id()}/notify`, { message }).subscribe({
      next: () => {
        this.busy.set(false);
        this.toasts.success('Повідомлення надіслано');
        this.load();
      },
      error: (e) => {
        this.busy.set(false);
        this.toasts.error(errorMessage(e));
      },
    });
  }

  // ----- items -----
  startEditItems() {
    this.items.set((this.order()?.items ?? []).map((i) => ({ ...i })));
    this.editItems.set(true);
  }

  updateItem(index: number, patch: Partial<EditItem>) {
    this.items.update((l) => l.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  removeItem(index: number) {
    this.items.update((l) => l.filter((_, i) => i !== index));
  }

  searchVariants(q: string) {
    this.variantQuery = q;
    clearTimeout(this.searchTimer);
    if (q.trim().length < 2) return this.variantResults.set([]);
    this.searchTimer = setTimeout(() => {
      this.api.get<VariantSearchRow[]>('/variants/search', { q }).subscribe((r) => this.variantResults.set(r));
    }, 250);
  }

  addVariant(v: VariantSearchRow) {
    this.items.update((l) => [...l, { variant_id: v.id, name: v.name, size: v.size, color: v.color, image_url: v.image, price: v.price, quantity: 1 }]);
    this.variantResults.set([]);
    this.variantQuery = '';
  }

  saveItems() {
    const items = this.items();
    if (!items.length) {
      this.toasts.error('У замовленні має залишитися хоча б один товар');
      return;
    }
    this.busy.set(true);
    this.api
      .put<AdminOrder>(`/orders/${this.id()}/items`, {
        items: items.map((i) => (i.id ? { id: i.id, quantity: Number(i.quantity), price: Number(i.price) } : { variant_id: i.variant_id, quantity: Number(i.quantity), price: Number(i.price) })),
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.editItems.set(false);
          this.toasts.success('Склад замовлення оновлено');
          this.load();
        },
        error: (e) => {
          this.busy.set(false);
          this.toasts.error(errorMessage(e));
        },
      });
  }

  async remove() {
    const o = this.order();
    if (!o) return;
    if (!(await this.confirm.ask(`Видалити замовлення ${o.number} назавжди? Цю дію не можна скасувати.`, { confirmLabel: 'Видалити', danger: true }))) return;
    this.api.delete(`/orders/${o.id}`).subscribe({
      next: () => {
        this.toasts.success(`Замовлення ${o.number} видалено`);
        this.api.refreshBadges();
        this.router.navigateByUrl('/admin/orders');
      },
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }

  ttnCreated(o: AdminOrder) {
    this.ttnOpen.set(false);
    this.apply(o);
    this.load();
  }

  async openTtn(kind: 'document' | 'marking') {
    try {
      await this.api.openPdf(`/orders/${this.id()}/ttn.pdf`, { kind });
    } catch (e) {
      this.toasts.error(errorMessage(e, 'Не вдалося отримати PDF від Нової пошти'));
    }
  }

  async deleteTtn() {
    if (!(await this.confirm.ask('Видалити ТТН у Новій пошті? Це можливо, поки посилку не прийняли у відділенні.', { danger: true, confirmLabel: 'Видалити ТТН' }))) return;
    this.api.delete<AdminOrder>(`/orders/${this.id()}/ttn`).subscribe({
      next: (o) => {
        this.apply(o);
        this.load();
        this.toasts.success('ТТН видалено');
      },
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }

  codPaid() {
    this.api.post(`/cod/${this.id()}/paid`, {}).subscribe({
      next: () => {
        this.toasts.success('Позначено: гроші отримано');
        this.load();
      },
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }

  print() {
    window.print();
  }

  copy(text: string) {
    navigator.clipboard?.writeText(text).then(() => this.toasts.show('Скопійовано'));
  }

  waLink(): string {
    return `https://wa.me/${this.phone()}?text=${encodeURIComponent(this.message)}`;
  }
  viberLink(): string {
    return `viber://chat?number=%2B${this.phone()}`;
  }
  tgLink(): string {
    return `https://t.me/+${this.phone()}`;
  }
}
