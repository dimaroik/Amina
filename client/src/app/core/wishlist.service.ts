import { Injectable, computed, effect, signal } from '@angular/core';
import type { ProductCard } from './models';
import { storage } from './storage';

@Injectable({ providedIn: 'root' })
export class Wishlist {
  readonly items = signal<ProductCard[]>(storage.get<ProductCard[]>('amina.wishlist', []));
  readonly count = computed(() => this.items().length);
  private ids = computed(() => new Set(this.items().map((p) => p.id)));

  constructor() {
    effect(() => storage.set('amina.wishlist', this.items()));
  }

  has(id: number): boolean {
    return this.ids().has(id);
  }

  /** Returns true when the product ended up in the wishlist. */
  toggle(product: ProductCard): boolean {
    if (this.has(product.id)) {
      this.items.update((l) => l.filter((p) => p.id !== product.id));
      return false;
    }
    this.items.update((l) => [product, ...l]);
    return true;
  }
}
