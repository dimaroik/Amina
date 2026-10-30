import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, Subscription, debounceTime, distinctUntilChanged, of, switchMap, catchError } from 'rxjs';
import { Api, errorMessage } from '../../../core/api.service';
import { Auth } from '../../../core/auth.service';
import { Analytics } from '../../../core/analytics.service';
import { Cart } from '../../../core/cart.service';
import type { CheckoutConfig, CreateOrderRequest, DeliveryMethod, OrderResponse, PaymentCode } from '../../../core/models';
import { storage } from '../../../core/storage';
import { Store } from '../../../core/store.service';
import { Toasts } from '../../../core/toast.service';
import { Icon } from '../../../shared/icon';
import { UahPipe } from '../../../shared/uah.pipe';

type Channel = CreateOrderRequest['customer']['contactChannel'];
interface City { ref: string; name: string; area: string }
interface Warehouse { ref: string; name: string; number: string }

const CHANNELS: { id: Channel; label: string; icon: string }[] = [
  { id: 'phone', label: 'Дзвінок', icon: 'phone' },
  { id: 'telegram', label: 'Telegram', icon: 'telegram' },
  { id: 'viber', label: 'Viber', icon: 'viber' },
  { id: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp' },
];
const PAY_ICONS: Record<PaymentCode, string> = { mono_jar: 'qr', mono_acquiring: 'card', iban: 'copy', cod: 'truck' };

export function formatPhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0')) d = '38' + d;
  else if (d.startsWith('80')) d = '3' + d;
  else if (!d.startsWith('380') && d.length <= 9) d = '380' + d;
  d = d.slice(0, 12);
  const p = [d.slice(0, 3), d.slice(3, 5), d.slice(5, 8), d.slice(8, 10), d.slice(10, 12)].filter(Boolean);
  return '+' + p.join(' ');
}

@Component({
  selector: 'app-checkout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Icon, UahPipe],
  templateUrl: './checkout.html',
  styleUrl: './checkout.scss',
})
export class CheckoutPage {
  private api = inject(Api);
  private store = inject(Store);
  private auth = inject(Auth);
  private router = inject(Router);
  private toasts = inject(Toasts);
  protected cart = inject(Cart);

  protected channels = CHANNELS;
  protected payIcons = PAY_ICONS;
  protected config = signal<CheckoutConfig | null>(null);
  protected submitted = signal(false);
  protected sending = signal(false);
  protected notes = signal<string[]>([]);

  // form state
  protected name = signal('');
  protected phone = signal('');
  protected email = signal('');
  protected channel = signal<Channel>('phone');
  protected deliveryId = signal<number | null>(null);
  protected city = signal('');
  protected cityRef = signal('');
  protected branch = signal('');
  protected address = signal('');
  protected payment = signal<PaymentCode | null>(null);
  protected comment = signal('');
  protected promoInput = signal('');
  protected promo = signal<{ code: string; discount: number } | null>(null);
  protected promoBusy = signal(false);
  protected promoOpen = signal(false);

  // nova poshta autocomplete
  protected cities = signal<City[]>([]);
  protected warehouses = signal<Warehouse[]>([]);
  protected cityOpen = signal(false);
  protected whOpen = signal(false);
  private cityQ = new Subject<string>();
  private whQ = new Subject<string>();

  protected delivery = computed<DeliveryMethod | null>(() => this.config()?.delivery.find((d) => d.id === this.deliveryId()) ?? null);
  protected discount = computed(() => this.promo()?.discount ?? 0);
  protected deliveryCost = computed(() => {
    const d = this.delivery();
    if (!d) return 0;
    const after = this.cart.subtotal() - this.discount();
    return d.free_from !== null && after >= d.free_from ? 0 : d.price;
  });
  protected deliveryLabel = computed(() => {
    const d = this.delivery();
    if (!d) return '—';
    if (this.deliveryCost() > 0) return null;
    if (d.type === 'pickup' || (d.free_from !== null && d.price > 0)) return 'Безкоштовно';
    return 'за тарифами перевізника';
  });
  protected total = computed(() => Math.max(0, this.cart.subtotal() - this.discount()) + this.deliveryCost());
  protected np = computed(() => !!this.config()?.novaPoshta && this.delivery()?.type === 'np_warehouse');

  protected errors = computed(() => {
    const e: Record<string, string> = {};
    if (this.name().trim().length < 2) e['name'] = 'Вкажіть ім’я та прізвище';
    if (this.phone().replace(/\D/g, '').length !== 12) e['phone'] = 'Вкажіть номер у форматі +380 XX XXX XX XX';
    if (this.email() && !/^\S+@\S+\.\S+$/.test(this.email())) e['email'] = 'Некоректний email';
    const d = this.delivery();
    if (!d) e['delivery'] = 'Оберіть спосіб доставки';
    else if (d.type !== 'pickup') {
      if (!this.city().trim()) e['city'] = 'Вкажіть місто';
      if (d.type === 'np_warehouse' && !this.branch().trim()) e['branch'] = 'Оберіть відділення або поштомат';
      if ((d.type === 'np_courier' || d.type === 'address') && !this.address().trim()) e['address'] = 'Вкажіть адресу';
    }
    if (!this.payment()) e['payment'] = 'Оберіть спосіб оплати';
    return e;
  });
  protected hasErrors = computed(() => Object.keys(this.errors()).length > 0);

  constructor() {
    const items = this.cart.items();
    if (items.length) {
      inject(Analytics).beginCheckout(items.map((i) => ({ id: i.productId, name: i.name, price: i.price, quantity: i.quantity, variant: [i.color, i.size].filter(Boolean).join(' / ') })));
    }
    const subs: Subscription[] = [];
    inject(DestroyRef).onDestroy(() => subs.forEach((s) => s.unsubscribe()));

    // prefill: saved contact > account
    const saved = storage.get<Partial<Record<string, string>>>('amina.checkout', {});
    const u = this.auth.user();
    this.name.set(saved['name'] ?? u?.name ?? '');
    this.phone.set(formatPhone(saved['phone'] ?? u?.phone ?? ''));
    this.email.set(saved['email'] ?? u?.email ?? '');
    this.city.set(saved['city'] ?? '');
    this.cityRef.set(saved['cityRef'] ?? '');
    if (saved['channel']) this.channel.set(saved['channel'] as Channel);

    subs.push(
      this.store.checkoutConfig().subscribe({
        next: (c) => {
          this.config.set(c);
          if (c.delivery[0]) this.deliveryId.set(Number(saved['deliveryId']) && c.delivery.some((d) => d.id === Number(saved['deliveryId'])) ? Number(saved['deliveryId']) : c.delivery[0].id);
          if (c.payments[0]) this.payment.set(c.payments[0].code);
        },
        error: (e) => this.toasts.error(errorMessage(e)),
      }),
      this.cityQ.pipe(debounceTime(250), distinctUntilChanged(), switchMap((q) => (q.length < 2 ? of([]) : this.api.get<City[]>('/np/cities', { q }).pipe(catchError(() => of([])))))).subscribe((r) => this.cities.set(r)),
      this.whQ.pipe(debounceTime(250), switchMap((q) => (!this.cityRef() ? of([]) : this.api.get<Warehouse[]>('/np/warehouses', { cityRef: this.cityRef(), q }).pipe(catchError(() => of([])))))).subscribe((r) => this.warehouses.set(r)),
    );

    this.cart.revalidate().then((n) => this.notes.set(n)).catch(() => {});

    // a promo discount is validated for a specific subtotal, so re-check it when the cart changes
    let lastSubtotal = this.cart.subtotal();
    effect(() => {
      const subtotal = this.cart.subtotal();
      untracked(() => {
        if (subtotal !== lastSubtotal && this.promo()) this.applyPromo(true);
        lastSubtotal = subtotal;
      });
    });
  }

  setPhone(v: string) {
    this.phone.set(formatPhone(v));
  }

  onCity(v: string) {
    this.city.set(v);
    this.cityRef.set('');
    this.branch.set('');
    if (this.np()) {
      this.cityOpen.set(true);
      this.cityQ.next(v.trim());
    }
  }
  pickCity(c: City) {
    this.city.set(c.name);
    this.cityRef.set(c.ref);
    this.cityOpen.set(false);
    this.branch.set('');
    this.whQ.next('');
  }
  onBranch(v: string) {
    this.branch.set(v);
    if (this.np() && this.cityRef()) {
      this.whOpen.set(true);
      this.whQ.next(v.trim());
    }
  }
  openWarehouses() {
    if (this.np() && this.cityRef()) {
      this.whOpen.set(true);
      this.whQ.next(this.branch());
    }
  }
  pickWarehouse(w: Warehouse) {
    this.branch.set(w.name);
    this.whOpen.set(false);
  }
  closeLists() {
    setTimeout(() => {
      this.cityOpen.set(false);
      this.whOpen.set(false);
    }, 180);
  }

  applyPromo(silent = false) {
    const code = (this.promo()?.code ?? this.promoInput()).trim();
    if (!code) return;
    this.promoBusy.set(true);
    this.api.post<{ discount: number; promo: { code: string } }>('/promo/validate', { code, subtotal: this.cart.subtotal() }).subscribe({
      next: (r) => {
        this.promoBusy.set(false);
        this.promo.set({ code: r.promo.code, discount: r.discount });
        if (!silent) this.toasts.success(`Промокод ${r.promo.code} застосовано`);
      },
      error: (e) => {
        this.promoBusy.set(false);
        this.promo.set(null);
        this.toasts.error(errorMessage(e));
      },
    });
  }
  removePromo() {
    this.promo.set(null);
    this.promoInput.set('');
  }

  submit() {
    this.submitted.set(true);
    if (this.hasErrors()) {
      setTimeout(() => document.querySelector('.err')?.closest('.block')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return;
    }
    const body: CreateOrderRequest = {
      customer: { name: this.name().trim(), phone: this.phone(), email: this.email().trim(), contactChannel: this.channel() },
      deliveryMethodId: this.deliveryId()!,
      delivery: {
        city: this.delivery()?.type === 'pickup' ? '' : this.city().trim(),
        cityRef: this.cityRef(),
        branch: this.delivery()?.type === 'np_warehouse' ? this.branch().trim() : '',
        address: this.delivery()?.type === 'np_courier' || this.delivery()?.type === 'address' ? this.address().trim() : '',
      },
      paymentMethod: this.payment()!,
      promoCode: this.promo()?.code,
      comment: this.comment().trim(),
      items: this.cart.items().map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
    };
    storage.set('amina.checkout', {
      name: body.customer.name, phone: body.customer.phone, email: body.customer.email, channel: body.customer.contactChannel,
      city: this.city(), cityRef: this.cityRef(), deliveryId: String(this.deliveryId()),
    });
    this.sending.set(true);
    this.api.post<OrderResponse>('/orders', body).subscribe({
      next: (res) => {
        try {
          sessionStorage.setItem('amina.lastOrder', JSON.stringify(res));
        } catch { /* ignore */ }
        this.cart.clear();
        this.router.navigate(['/order', res.order.number], { queryParams: { token: res.accessToken } });
      },
      error: async (e) => {
        this.sending.set(false);
        this.toasts.error(errorMessage(e));
        if (e instanceof HttpErrorResponse && (e.status === 409 || e.status === 400)) {
          const notes = await this.cart.revalidate().catch(() => []);
          this.notes.set(notes);
        }
      },
    });
  }
}
