import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../../../core/api.service';
import type { ProductDetail, ReviewFit } from '../../../core/models';
import { Icon } from '../../../shared/icon';

/** "Write a review" dialog: stars, text, fit, up to 4 photos, optional order check. */
@Component({
  selector: 'app-review-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon],
  host: { '(document:keydown.escape)': 'close.emit()' },
  template: `
    <div class="wrap" (click)="close.emit()">
      <div class="box" (click)="$event.stopPropagation()" role="dialog" aria-modal="true" aria-label="Написати відгук">
        <button class="icon-btn x" (click)="close.emit()" aria-label="Закрити"><app-icon name="close" /></button>
        @if (!done()) {
          <h3 class="h3">Ваш відгук</h3>
          <p class="muted small">{{ product().name }}</p>

          <div class="rate" (mouseleave)="hover.set(0)">
            @for (n of [1, 2, 3, 4, 5]; track n) {
              <button type="button" [class.on]="n <= (hover() || rating())" (mouseenter)="hover.set(n)" (click)="rating.set(n)" [attr.aria-label]="n + ' з 5'">★</button>
            }
          </div>

          <div class="form-grid">
            <div class="field full"><label class="label" for="rv-name">Ваше ім'я</label><input id="rv-name" class="input" [(ngModel)]="name" maxlength="60" /></div>
            <div class="field full"><label class="label" for="rv-text">Враження</label>
              <textarea id="rv-text" class="textarea" rows="4" [(ngModel)]="text" maxlength="2000" placeholder="Як сіла річ, якість тканини, чи відповідає фото…"></textarea></div>
            @if (sizes().length) {
              <div class="field"><label class="label" for="rv-size">Ваш розмір</label>
                <select id="rv-size" class="select" [(ngModel)]="size"><option value="">—</option>@for (s of sizes(); track s) { <option [value]="s">{{ s }}</option> }</select></div>
            }
            <div class="field"><label class="label" for="rv-h">Зріст, см</label><input id="rv-h" class="input" type="number" min="100" max="220" [(ngModel)]="height" placeholder="168" /></div>
            <div class="field full">
              <span class="label">Як сідає</span>
              <div class="chips">
                @for (f of fits; track f.v) { <button type="button" class="chip" [class.active]="fit() === f.v" (click)="fit.set(fit() === f.v ? null : f.v)">{{ f.l }}</button> }
              </div>
            </div>
            <div class="field full">
              <span class="label">Фото (до 4)</span>
              <div class="photos">
                @for (p of photos(); track p; let i = $index) {
                  <div class="ph"><img [src]="p" alt="" /><button type="button" (click)="removePhoto(i)" aria-label="Прибрати"><app-icon name="close" [size]="12" /></button></div>
                }
                @if (photos().length < 4) {
                  <label class="add" [class.busy]="uploading()">
                    <input type="file" accept="image/*" multiple hidden (change)="upload($event)" />
                    @if (uploading()) { <span class="spinner"></span> } @else { <app-icon name="image" [size]="20" /><span class="tiny">Додати</span> }
                  </label>
                }
              </div>
            </div>
            <details class="full verify">
              <summary class="small">Купували в нас? Позначте відгук як «Перевірена покупка»</summary>
              <div class="form-grid" style="margin-top:10px">
                <div class="field"><label class="label" for="rv-ord">Номер замовлення</label><input id="rv-ord" class="input" [(ngModel)]="orderNumber" placeholder="AM-1001" /></div>
                <div class="field"><label class="label" for="rv-ph">Телефон із замовлення</label><input id="rv-ph" class="input" type="tel" [(ngModel)]="phone" placeholder="+380" /></div>
              </div>
            </details>
          </div>
          @if (error()) { <p class="err small">{{ error() }}</p> }
          <button class="btn btn-block" [disabled]="busy() || uploading()" (click)="submit()">{{ busy() ? 'Надсилаємо…' : 'Надіслати відгук' }}</button>
        } @else {
          <div class="ok"><app-icon name="check" [size]="26" [stroke]="1.8" /></div>
          <h3 class="h3">Дякуємо за відгук!</h3>
          <p class="muted small">Він з'явиться на сайті після перевірки — зазвичай протягом дня.</p>
          <button class="btn btn-block" (click)="close.emit()">Добре</button>
        }
      </div>
    </div>
  `,
  styles: `
    .wrap { position: fixed; inset: 0; z-index: 300; background: rgba(31,29,26,.4); display: grid; place-items: center; padding: 16px; animation: fade .25s; }
    @keyframes fade { from { opacity: 0; } }
    .box { position: relative; background: var(--bg); width: min(560px, 100%); max-height: 92vh; overflow-y: auto; padding: 28px 24px 24px; display: flex; flex-direction: column; gap: 14px; animation: rise .35s var(--ease); }
    @keyframes rise { from { opacity: 0; transform: translateY(14px); } }
    .x { position: absolute; top: 8px; right: 8px; }
    .h3, p { margin: 0; }
    .rate { display: flex; gap: 2px; }
    .rate button { border: 0; background: none; font-size: 32px; line-height: 1; padding: 2px; color: var(--line-strong); transition: color .15s, transform .15s; }
    .rate button.on { color: var(--ink); }
    .rate button:hover { transform: scale(1.12); }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .photos { display: flex; flex-wrap: wrap; gap: 8px; }
    .ph, .add { width: 72px; height: 90px; position: relative; background: var(--surface-2); border-radius: 4px; overflow: hidden; }
    .ph img { width: 100%; height: 100%; object-fit: cover; }
    .ph button { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; border-radius: 50%; border: 0; background: rgba(255,255,255,.9); display: grid; place-items: center; }
    .add { border: 1.5px dashed var(--line-strong); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; cursor: pointer; color: var(--muted); }
    .add:hover { border-color: var(--ink); color: var(--ink); }
    .verify summary { cursor: pointer; color: var(--ink-2); }
    .err { color: var(--danger); }
    .ok { width: 56px; height: 56px; border-radius: 50%; background: var(--ink); color: var(--bg); display: grid; place-items: center; align-self: center; }
    .box:has(.ok) { text-align: center; align-items: center; }
  `,
})
export class ReviewForm {
  private api = inject(Api);
  readonly product = input.required<ProductDetail>();
  readonly close = output<void>();
  readonly submitted = output<void>();

  protected fits: { v: ReviewFit; l: string }[] = [
    { v: 'small', l: 'Маломірить' },
    { v: 'true', l: 'В розмір' },
    { v: 'large', l: 'Великомірить' },
  ];
  protected sizes = computed(() => [...new Set(this.product().variants.map((v) => v.size).filter(Boolean))]);
  protected rating = signal(5);
  protected hover = signal(0);
  protected fit = signal<ReviewFit | null>(null);
  protected photos = signal<string[]>([]);
  protected uploading = signal(false);
  protected busy = signal(false);
  protected error = signal('');
  protected done = signal(false);
  protected name = '';
  protected text = '';
  protected size = '';
  protected height: number | null = null;
  protected orderNumber = '';
  protected phone = '';

  upload(e: Event) {
    const el = e.target as HTMLInputElement;
    const files = Array.from(el.files ?? []).slice(0, 4 - this.photos().length);
    el.value = '';
    if (!files.length) return;
    this.uploading.set(true);
    this.error.set('');
    this.api.upload<{ url: string }[]>('/reviews/photos', files).subscribe({
      next: (r) => {
        this.uploading.set(false);
        this.photos.update((p) => [...p, ...r.map((x) => x.url)].slice(0, 4));
      },
      error: (err) => {
        this.uploading.set(false);
        this.error.set(errorMessage(err, 'Не вдалося завантажити фото'));
      },
    });
  }

  removePhoto(i: number) {
    this.photos.update((p) => p.filter((_, j) => j !== i));
  }

  submit() {
    this.busy.set(true);
    this.error.set('');
    const body = {
      name: this.name.trim(),
      rating: this.rating(),
      text: this.text.trim(),
      size: this.size,
      height: this.height ? Number(this.height) : null,
      fit: this.fit(),
      photos: this.photos(),
      orderNumber: this.orderNumber.trim() || undefined,
      phone: this.phone.trim() || undefined,
    };
    this.api.post(`/products/${this.product().slug}/reviews`, body).subscribe({
      next: () => {
        this.busy.set(false);
        this.done.set(true);
        this.submitted.emit();
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}
