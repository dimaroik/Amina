import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Api } from '../../../core/api.service';
import type { ProductDetail, Review, ReviewsResponse } from '../../../core/models';
import { Icon } from '../../../shared/icon';
import { Stars } from '../../../shared/stars';
import { ReviewForm } from './review-form';

const FIT_LABEL = { small: 'Маломірить', true: 'В розмір', large: 'Великомірить' } as const;

@Component({
  selector: 'app-product-reviews',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, Icon, Stars, ReviewForm],
  template: `
    <section class="reviews" id="reviews">
      <div class="head">
        <h2 class="h2">Відгуки</h2>
        <button class="btn btn-outline btn-sm" (click)="formOpen.set(true)"><app-icon name="edit" [size]="15" /> Написати відгук</button>
      </div>

      @if (data(); as d) {
        @if (d.summary.count) {
          <div class="summary">
            <div class="score">
              <div class="avg serif">{{ d.summary.avg.toFixed(1) }}</div>
              <app-stars [value]="d.summary.avg" [size]="18" />
              <div class="small muted">{{ d.summary.count }} {{ plural(d.summary.count) }}</div>
            </div>
            <div class="bars">
              @for (b of bars(); track b.n) {
                <div class="bar-row">
                  <span class="tiny">{{ b.n }} ★</span>
                  <span class="bar"><span [style.width.%]="b.share"></span></span>
                  <span class="tiny muted">{{ b.count }}</span>
                </div>
              }
            </div>
            @if (fitTotal()) {
              <div class="fit">
                <span class="label">Як сідає</span>
                <div class="fit-scale">
                  <span class="fit-dot" [style.left.%]="fitPos()"></span>
                </div>
                <div class="fit-legend tiny muted"><span>Маломірить</span><span>В розмір</span><span>Великомірить</span></div>
              </div>
            }
          </div>

          @if (d.photos.length) {
            <div class="gallery">
              @for (p of d.photos; track $index) {
                <button class="g-item" (click)="open(d.photos.map(x => x.url), $index)"><img [src]="p.url" alt="Фото покупця" loading="lazy" /></button>
              }
            </div>
          }

          <div class="list">
            @for (r of items(); track r.id) {
              <article class="review">
                <div class="r-head">
                  <div>
                    <b>{{ r.name }}</b>
                    @if (r.verified) { <span class="verified"><app-icon name="check" [size]="12" [stroke]="2.2" /> Перевірена покупка</span> }
                  </div>
                  <span class="tiny muted">{{ r.created_at | date: 'd MMMM yyyy' }}</span>
                </div>
                <app-stars [value]="r.rating" />
                @if (r.size || r.height || r.fit) {
                  <div class="meta tiny muted">
                    @if (r.size) { <span>Розмір: <b>{{ r.size }}</b></span> }
                    @if (r.height) { <span>Зріст: <b>{{ r.height }} см</b></span> }
                    @if (r.fit) { <span>{{ fitLabel[r.fit] }}</span> }
                  </div>
                }
                <p class="text">{{ r.text }}</p>
                @if (r.photos.length) {
                  <div class="r-photos">
                    @for (p of r.photos; track $index) { <button (click)="open(r.photos, $index)"><img [src]="p" alt="Фото до відгуку" loading="lazy" /></button> }
                  </div>
                }
                @if (r.admin_reply) {
                  <div class="reply"><span class="eyebrow">Відповідь Amina</span><p>{{ r.admin_reply }}</p></div>
                }
              </article>
            }
          </div>
          @if (page() < d.pages) {
            <button class="btn btn-ghost btn-sm more" [disabled]="loading()" (click)="more()">Показати ще відгуки</button>
          }
        } @else {
          <div class="empty">
            <app-stars [value]="0" [size]="20" />
            <p>Ще ніхто не залишив відгук. Будьте першою — розкажіть, як сіла річ!</p>
          </div>
        }
      }
    </section>

    @if (formOpen()) {
      <app-review-form [product]="product()" (close)="formOpen.set(false)" />
    }

    @if (viewer(); as v) {
      <div class="viewer" (click)="viewer.set(null)">
        <img [src]="v.list[v.i]" alt="" (click)="$event.stopPropagation(); step(1)" />
        <button class="icon-btn vx" aria-label="Закрити"><app-icon name="close" /></button>
        @if (v.list.length > 1) { <span class="vcount tiny">{{ v.i + 1 }} / {{ v.list.length }}</span> }
      </div>
    }
  `,
  styles: `
    .reviews { padding: 56px 0 24px; border-top: 1px solid var(--line); scroll-margin-top: 90px; }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 28px; }
    .summary { display: grid; gap: 28px; grid-template-columns: 1fr; margin-bottom: 28px; }
    @media (min-width: 900px) { .summary { grid-template-columns: 180px 1fr 1fr; align-items: center; } }
    .score { display: flex; flex-direction: column; gap: 6px; }
    .avg { font-size: 56px; line-height: 1; }
    .bars { display: flex; flex-direction: column; gap: 6px; max-width: 360px; }
    .bar-row { display: grid; grid-template-columns: 32px 1fr 28px; align-items: center; gap: 10px; }
    .bar { height: 4px; background: var(--line); position: relative; }
    .bar span { position: absolute; inset: 0 auto 0 0; background: var(--ink); }
    .fit { display: flex; flex-direction: column; gap: 10px; max-width: 360px; }
    .fit-scale { position: relative; height: 4px; background: var(--line); margin: 6px 0; }
    .fit-dot { position: absolute; top: 50%; width: 14px; height: 14px; border-radius: 50%; background: var(--ink); transform: translate(-50%, -50%); transition: left .5s var(--ease); }
    .fit-legend { display: flex; justify-content: space-between; }
    .gallery { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 6px; margin-bottom: 20px; scrollbar-width: thin; }
    .g-item, .r-photos button { flex: 0 0 auto; width: 88px; height: 110px; border: 0; padding: 0; background: var(--surface-2); cursor: zoom-in; overflow: hidden; }
    .g-item img, .r-photos img { width: 100%; height: 100%; object-fit: cover; transition: transform .4s var(--ease); }
    .g-item:hover img, .r-photos button:hover img { transform: scale(1.05); }
    .list { display: flex; flex-direction: column; }
    .review { padding: 22px 0; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 8px; }
    .r-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; flex-wrap: wrap; }
    .verified { display: inline-flex; align-items: center; gap: 4px; margin-left: 10px; font-size: 11px; color: var(--success); font-weight: 600; }
    .meta { display: flex; gap: 14px; flex-wrap: wrap; }
    .text { margin: 0; line-height: 1.7; white-space: pre-line; }
    .r-photos { display: flex; gap: 8px; flex-wrap: wrap; }
    .r-photos button { width: 72px; height: 90px; }
    .reply { background: var(--surface-2); padding: 12px 14px; margin-top: 4px; }
    .reply p { margin: 6px 0 0; font-size: 14px; }
    .more { margin-top: 12px; }
    .empty { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; color: var(--muted); padding: 8px 0 16px; }
    .empty p { margin: 0; }
    .viewer { position: fixed; inset: 0; z-index: 400; background: rgba(20,19,17,.92); display: grid; place-items: center; padding: 24px; animation: fade .2s; }
    @keyframes fade { from { opacity: 0; } }
    .viewer img { max-width: 100%; max-height: 88vh; object-fit: contain; cursor: pointer; }
    .vx { position: absolute; top: 12px; right: 12px; color: #fff; }
    .vcount { position: absolute; bottom: 16px; color: #fff; }
  `,
})
export class ProductReviews {
  private api = inject(Api);
  readonly product = input.required<ProductDetail>();

  protected fitLabel = FIT_LABEL;
  protected data = signal<ReviewsResponse | null>(null);
  protected items = signal<Review[]>([]);
  protected page = signal(1);
  protected loading = signal(false);
  protected formOpen = signal(false);
  protected viewer = signal<{ list: string[]; i: number } | null>(null);

  protected bars = computed(() => {
    const s = this.data()?.summary;
    if (!s) return [];
    return ([5, 4, 3, 2, 1] as const).map((n) => ({ n, count: s.distribution[n], share: s.count ? (s.distribution[n] / s.count) * 100 : 0 }));
  });

  protected fitTotal = computed(() => {
    const f = this.data()?.summary.fit;
    return f ? f.small + f.true + f.large : 0;
  });
  /** 0% = runs small, 50% = true to size, 100% = runs large */
  protected fitPos = computed(() => {
    const f = this.data()!.summary.fit;
    return ((f.true * 50 + f.large * 100) / this.fitTotal());
  });

  constructor() {
    effect(() => {
      const slug = this.product().slug;
      this.page.set(1);
      this.api.get<ReviewsResponse>(`/products/${slug}/reviews`).subscribe((r) => {
        this.data.set(r);
        this.items.set(r.items);
      });
    });
  }

  more() {
    this.loading.set(true);
    const next = this.page() + 1;
    this.api.get<ReviewsResponse>(`/products/${this.product().slug}/reviews`, { page: next }).subscribe((r) => {
      this.loading.set(false);
      this.page.set(next);
      this.items.update((list) => [...list, ...r.items]);
    });
  }

  plural(n: number) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'відгук';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'відгуки';
    return 'відгуків';
  }

  open(list: string[], i: number) {
    this.viewer.set({ list, i });
  }

  step(d: number) {
    const v = this.viewer();
    if (v) this.viewer.set({ ...v, i: (v.i + d + v.list.length) % v.list.length });
  }
}
