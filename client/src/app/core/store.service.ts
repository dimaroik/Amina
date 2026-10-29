import { Injectable, inject, signal } from '@angular/core';
import { Observable, shareReplay } from 'rxjs';
import { Api } from './api.service';
import type {
  Banner,
  Category,
  CategoryDetail,
  CheckoutConfig,
  FaqItem,
  ProductDetail,
  ProductListResponse,
  ProductQuery,
  PublicSettings,
} from './models';

/** Storefront data access with light caching for data that rarely changes. */
@Injectable({ providedIn: 'root' })
export class Store {
  private api = inject(Api);
  readonly settings = signal<PublicSettings | null>(null);
  readonly categories = signal<Category[]>([]);
  private faq$?: Observable<FaqItem[]>;

  constructor() {
    this.api.get<PublicSettings>('/settings/public').subscribe((s) => this.settings.set(s));
    this.api.get<Category[]>('/categories').subscribe((c) => this.categories.set(c));
  }

  products(q: ProductQuery): Observable<ProductListResponse> {
    return this.api.get<ProductListResponse>('/products', q as Record<string, string | number>);
  }
  product(slug: string): Observable<ProductDetail> {
    return this.api.get<ProductDetail>(`/products/${slug}`);
  }
  category(slug: string): Observable<CategoryDetail> {
    return this.api.get<CategoryDetail>(`/categories/${slug}`);
  }
  banners(): Observable<Banner[]> {
    return this.api.get<Banner[]>('/banners');
  }
  faq(): Observable<FaqItem[]> {
    return (this.faq$ ??= this.api.get<FaqItem[]>('/faq').pipe(shareReplay(1)));
  }
  checkoutConfig(): Observable<CheckoutConfig> {
    return this.api.get<CheckoutConfig>('/checkout/config');
  }
  subscribe(email: string): Observable<{ ok: boolean }> {
    return this.api.post('/subscribe', { email });
  }

  /** Finds a category by slug anywhere in the cached tree. */
  findCategory(slug: string, list = this.categories()): Category | null {
    for (const c of list) {
      if (c.slug === slug) return c;
      const found = this.findCategory(slug, c.children);
      if (found) return found;
    }
    return null;
  }
}
