import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Api } from './api.service';
import type { CartItem } from './models';
import { storage } from './storage';

interface CheckResult {
  items: {
    variantId: number;
    available: boolean;
    stock: number;
    price?: number;
    oldPrice?: number | null;
    name?: string;
    slug?: string;
    image?: string | null;
  }[];
}

@Injectable({ providedIn: 'root' })
export class Cart {
  private api = inject(Api);
  readonly items = signal<CartItem[]>(storage.get<CartItem[]>('amina.cart', []));
  readonly drawerOpen = signal(false);
  /** Bumps whenever an item is added — used for the header badge animation. */
  readonly pulse = signal(0);

  readonly count = computed(() => this.items().reduce((n, i) => n + i.quantity, 0));
  readonly subtotal = computed(() => this.items().reduce((s, i) => s + i.price * i.quantity, 0));
  readonly savings = computed(() =>
    this.items().reduce((s, i) => s + (i.oldPrice && i.oldPrice > i.price ? (i.oldPrice - i.price) * i.quantity : 0), 0),
  );

  constructor() {
    effect(() => storage.set('amina.cart', this.items()));
    // keep tabs in sync
    window.addEventListener('storage', (e) => {
      if (e.key === 'amina.cart') this.items.set(storage.get<CartItem[]>('amina.cart', []));
    });
  }

  add(item: Omit<CartItem, 'quantity'>, quantity = 1, openDrawer = true) {
    this.items.update((list) => {
      const existing = list.find((i) => i.variantId === item.variantId);
      if (existing) {
        return list.map((i) =>
          i.variantId === item.variantId ? { ...i, ...item, quantity: Math.min(i.quantity + quantity, item.stock || 99) } : i,
        );
      }
      return [...list, { ...item, quantity: Math.min(quantity, item.stock || 99) }];
    });
    this.pulse.update((n) => n + 1);
    if (openDrawer) this.drawerOpen.set(true);
  }

  setQuantity(variantId: number, quantity: number) {
    if (quantity <= 0) return this.remove(variantId);
    this.items.update((list) => list.map((i) => (i.variantId === variantId ? { ...i, quantity: Math.min(quantity, i.stock || 99) } : i)));
  }

  remove(variantId: number) {
    this.items.update((list) => list.filter((i) => i.variantId !== variantId));
  }

  clear() {
    this.items.set([]);
  }

  open() {
    this.drawerOpen.set(true);
  }
  close() {
    this.drawerOpen.set(false);
  }

  /** Refreshes prices and stock from the server; returns human-readable change notes. */
  async revalidate(): Promise<string[]> {
    const list = this.items();
    if (!list.length) return [];
    const notes: string[] = [];
    const res = await new Promise<CheckResult>((resolve, reject) =>
      this.api.post<CheckResult>('/cart/check', { items: list.map((i) => ({ variantId: i.variantId, quantity: i.quantity })) }).subscribe({ next: resolve, error: reject }),
    );
    const byId = new Map(res.items.map((r) => [r.variantId, r]));
    const next: CartItem[] = [];
    for (const item of list) {
      const r = byId.get(item.variantId);
      if (!r || !r.available) {
        notes.push(`«${item.name}» (${item.size}) більше немає в наявності`);
        continue;
      }
      const quantity = Math.min(item.quantity, r.stock);
      if (quantity < item.quantity) notes.push(`«${item.name}»: доступно лише ${r.stock} шт.`);
      if (r.price !== undefined && r.price !== item.price) notes.push(`Ціна «${item.name}» змінилась`);
      next.push({ ...item, quantity, stock: r.stock, price: r.price ?? item.price, oldPrice: r.oldPrice ?? null, image: r.image ?? item.image });
    }
    this.items.set(next);
    return notes;
  }
}
