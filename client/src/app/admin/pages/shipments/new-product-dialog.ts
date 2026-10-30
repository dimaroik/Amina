import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/api.service';
import type { Category } from '../../../core/models';
import { Icon } from '../../../shared/icon';
import { AdminApi, flattenCategories, type Currency, type Shipment } from '../../admin-api';
import { ImageUpload } from '../../ui/image-upload';
import { Modal } from '../../ui/modal';

const SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', 'One size'];
const COLORS: [string, string][] = [
  ['Чорний', '#2f2c28'], ['Білий', '#f7f5f0'], ['Молочний', '#e4d9c8'], ['Бежевий', '#c9b8a3'], ['Капучино', '#a28c76'],
  ['Шоколад', '#6f5442'], ['Графіт', '#4a4f57'], ['Сірий', '#9a9893'], ['Оливковий', '#7d8270'], ['Теракота', '#b9735c'],
  ['Пудровий', '#d9b8ae'], ['Синій', '#3c4a63'], ['Бордо', '#6e2f35'],
];

interface Line { size: string; color: string; color_hex: string | null; quantity: number }

/** Quick product creation inside a shipment: the product stays hidden until the shipment is received. */
@Component({
  selector: 'adm-shipment-new-product',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon, Modal, ImageUpload],
  template: `
    <adm-modal title="Новий товар у поставці" width="760px" (close)="close.emit()">
      <div class="adm-stack" style="gap:16px">
        <div class="form-grid">
          <div class="field full"><label class="label">Назва *</label><input class="input" [(ngModel)]="name" placeholder="Сукня трикотажна" /></div>
          <div class="field"><label class="label">Категорія</label>
            <select class="select" [(ngModel)]="categoryId"><option [ngValue]="null">— Без категорії —</option>
              @for (c of categories(); track c.id) { <option [ngValue]="c.id">{{ c.label }}</option> }</select></div>
          <div class="field"><label class="label">Закупівельна ціна за 1 шт., {{ currency() }}</label><input class="input" type="number" min="0" step="0.01" [(ngModel)]="unitPrice" /></div>
          <div class="field"><label class="label">Ціна продажу, ₴ *</label><input class="input" type="number" min="0" [(ngModel)]="price" /></div>
          <div class="field"><label class="label">Стара ціна, ₴</label><input class="input" type="number" min="0" [(ngModel)]="oldPrice" placeholder="—" /></div>
          <div class="field full"><label class="label">Опис</label><textarea class="textarea" rows="2" [(ngModel)]="description"></textarea></div>
        </div>

        <div class="field">
          <span class="label">Фото</span>
          @if (images().length) {
            <div class="imgs">@for (u of images(); track u; let i = $index) { <div class="img"><img [src]="u" alt="" /><button (click)="removeImage(i)"><app-icon name="close" [size]="12" /></button></div> }</div>
          }
          <adm-image-upload label="Додати фото" (uploaded)="images.set([...images(), ...$event])" />
        </div>

        <div class="field">
          <span class="label">Розміри</span>
          <div class="chips">@for (s of sizes; track s) { <button class="chip" [class.active]="pickedSizes().has(s)" (click)="toggle(pickedSizes, s)">{{ s }}</button> }</div>
        </div>
        <div class="field">
          <span class="label">Кольори</span>
          <div class="chips">@for (c of colors; track c[0]) { <button class="chip" [class.active]="pickedColors().has(c[0])" (click)="toggle(pickedColors, c[0])"><span class="sw" [style.background]="c[1]"></span>{{ c[0] }}</button> }</div>
        </div>

        @if (lines().length) {
          <div class="field">
            <div class="adm-between"><span class="label">Кількість у поставці</span>
              <span class="adm-row" style="gap:6px"><span class="tiny adm-muted">усім</span><input class="input qty" type="number" min="1" [ngModel]="bulkQty" (ngModelChange)="setAll($event)" /></span></div>
            <div class="matrix">
              @for (l of lines(); track l.size + l.color) {
                <label class="cell"><span class="small">{{ label(l) }}</span>
                  <input class="input qty" type="number" min="1" [ngModel]="l.quantity" (ngModelChange)="l.quantity = $event; lines.set([...lines()])" /></label>
              }
            </div>
            <span class="adm-hint">Разом {{ totalQty() }} шт. Товар з'явиться на сайті після оприбуткування поставки.</span>
          </div>
        }
        @if (error()) { <p class="err small">{{ error() }}</p> }
      </div>
      <ng-container foot>
        <button class="btn btn-ghost btn-sm" (click)="close.emit()">Скасувати</button>
        <button class="btn btn-sm" [disabled]="busy()" (click)="save()">{{ busy() ? 'Додаємо…' : 'Додати в поставку' }}</button>
      </ng-container>
    </adm-modal>
  `,
  styles: `
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chips .chip { min-height: 30px; font-size: 12px; padding: 0 10px; }
    .sw { width: 12px; height: 12px; border-radius: 50%; border: 1px solid rgba(0,0,0,.15); }
    .imgs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
    .img { position: relative; width: 64px; height: 80px; border-radius: 6px; overflow: hidden; background: var(--surface-2); }
    .img img { width: 100%; height: 100%; object-fit: cover; }
    .img button { position: absolute; top: 3px; right: 3px; width: 20px; height: 20px; border-radius: 50%; border: 0; background: rgba(255,255,255,.9); display: grid; place-items: center; }
    .matrix { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin: 6px 0; }
    .cell { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px 6px 12px; border: 1px solid var(--line); border-radius: 8px; background: #fbfaf7; }
    .qty { width: 70px !important; min-height: 32px !important; padding: 4px 8px !important; }
    .err { color: var(--danger); margin: 0; }
  `,
})
export class ShipmentNewProductDialog {
  private api = inject(AdminApi);
  readonly shipmentId = input.required<number>();
  readonly currency = input.required<Currency>();
  readonly close = output<void>();
  readonly added = output<Shipment>();

  protected sizes = SIZES;
  protected colors = COLORS;
  protected categories = signal<{ id: number; label: string }[]>([]);
  protected pickedSizes = signal(new Set<string>(['S', 'M', 'L']));
  protected pickedColors = signal(new Set<string>());
  protected images = signal<string[]>([]);
  protected busy = signal(false);
  protected error = signal('');
  protected name = '';
  protected categoryId: number | null = null;
  protected price: number | null = null;
  protected oldPrice: number | null = null;
  protected unitPrice: number | null = null;
  protected description = '';
  protected bulkQty = 1;
  protected lines = signal<Line[]>([]);
  protected totalQty = computed(() => this.lines().reduce((n, l) => n + (Number(l.quantity) || 0), 0));

  constructor() {
    this.api.get<Category[]>('/categories').subscribe((t) => this.categories.set(flattenCategories(t)));
    this.rebuild();
  }

  label(l: Line) {
    return [l.color, l.size].filter(Boolean).join(' · ');
  }

  toggle(sig: typeof this.pickedSizes, v: string) {
    sig.update((s) => {
      const n = new Set(s);
      n.has(v) ? n.delete(v) : n.add(v);
      return n;
    });
    this.rebuild();
  }

  /** Size × colour grid; quantities already typed in are kept. */
  private rebuild() {
    const prev = new Map(this.lines().map((l) => [`${l.color}|${l.size}`, l.quantity]));
    const sizes = SIZES.filter((s) => this.pickedSizes().has(s));
    const colors = COLORS.filter((c) => this.pickedColors().has(c[0]));
    const out: Line[] = [];
    for (const [color, hex] of colors.length ? colors : [['', null] as [string, string | null]]) {
      for (const size of sizes.length ? sizes : ['']) {
        if (!size && !color) continue;
        out.push({ size, color, color_hex: hex, quantity: prev.get(`${color}|${size}`) ?? this.bulkQty });
      }
    }
    this.lines.set(out);
  }

  setAll(v: number) {
    this.bulkQty = Number(v) || 1;
    this.lines.update((l) => l.map((x) => ({ ...x, quantity: this.bulkQty })));
  }

  removeImage(i: number) {
    this.images.update((l) => l.filter((_, j) => j !== i));
  }

  save() {
    const lines = this.lines().map((l) => ({ size: l.size, color: l.color, color_hex: l.color_hex, quantity: Number(l.quantity) || 1 }));
    if (!this.name.trim()) return this.error.set('Вкажіть назву');
    if (!this.price) return this.error.set('Вкажіть ціну продажу');
    if (!lines.length) return this.error.set('Оберіть хоча б один розмір або колір');
    this.busy.set(true);
    this.error.set('');
    const body = {
      product: {
        name: this.name.trim(),
        category_id: this.categoryId,
        price: Number(this.price),
        old_price: this.oldPrice ? Number(this.oldPrice) : null,
        description: this.description,
        images: this.images().map((url) => ({ url, alt: '', color: null })),
        is_new: true,
      },
      unit_price: Number(this.unitPrice) || 0,
      lines,
    };
    this.api.post<Shipment>(`/shipments/${this.shipmentId()}/products`, body).subscribe({
      next: (s) => {
        this.busy.set(false);
        this.added.emit(s);
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }
}
