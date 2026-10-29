import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CdkDrag, CdkDragDrop, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { errorMessage } from '../../../core/api.service';
import type { Category } from '../../../core/models';
import { Toasts } from '../../../core/toast.service';
import { Icon } from '../../../shared/icon';
import { AdminApi, flattenCategories, type AdminProduct, type AdminVariant } from '../../admin-api';
import type { HasUnsavedChanges } from '../../admin.routes';
import { Confirm } from '../../ui/confirm';
import { ImageUpload } from '../../ui/image-upload';

const SIZE_PRESETS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', 'One size'];
const COLOR_PRESETS: [string, string][] = [
  ['Чорний', '#2f2c28'], ['Білий', '#f7f5f0'], ['Молочний', '#e4d9c8'], ['Бежевий', '#c9b8a3'], ['Пісочний', '#d6c4a8'],
  ['Капучино', '#a28c76'], ['Шоколад', '#6f5442'], ['Графіт', '#4a4f57'], ['Сірий', '#9a9893'], ['Оливковий', '#7d8270'],
  ['Теракота', '#b9735c'], ['Пудровий', '#d9b8ae'], ['Синій', '#3c4a63'], ['Бордо', '#6e2f35'],
];

const blank = (): AdminProduct => ({
  name: '', slug: '', category_id: null, sku: '', description: '', composition: '', care: '',
  price: 0, old_price: null, is_active: true, is_featured: false, is_new: true, tags: [], images: [], variants: [],
});

@Component({
  selector: 'app-admin-product-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, CdkDropList, CdkDrag, Icon, ImageUpload],
  template: `
    <div class="adm-page">
      <a routerLink="/admin/products" class="adm-back"><app-icon name="arrow-left" [size]="14" /> Усі товари</a>
      <div class="adm-page-head">
        <div><h1>{{ isNew() ? 'Новий товар' : p().name || 'Товар' }}</h1>
          @if (!isNew()) { <div class="sub">Артикул {{ p().sku || '—' }} · {{ totalStock() }} шт. на складі</div> }
        </div>
        <div class="actions">
          @if (!isNew() && p().slug) { <a class="btn btn-ghost btn-sm" [href]="'/product/' + p().slug" target="_blank"><app-icon name="eye" [size]="15" /> На сайті</a> }
          @if (!isNew()) { <button class="btn btn-ghost btn-sm" (click)="duplicate()"><app-icon name="copy" [size]="15" /> Дублювати</button> }
        </div>
      </div>

      @if (loaded()) {
        @let d = p();
        <div class="adm-split">
          <div class="adm-stack">
            <div class="adm-card pad">
              <div class="form-grid">
                <div class="field full"><label class="label">Назва *</label><input class="input" [(ngModel)]="d.name" (ngModelChange)="touch()" placeholder="Сукня міді з льону" /></div>
                <div class="field full"><label class="label">Опис</label><textarea class="textarea" rows="5" [(ngModel)]="d.description" (ngModelChange)="touch()"></textarea></div>
                <div class="field"><label class="label">Склад</label><textarea class="textarea" rows="2" [(ngModel)]="d.composition" (ngModelChange)="touch()" placeholder="100% льон"></textarea></div>
                <div class="field"><label class="label">Догляд</label><textarea class="textarea" rows="2" [(ngModel)]="d.care" (ngModelChange)="touch()" placeholder="Прання при 30°C"></textarea></div>
              </div>
            </div>

            <div class="adm-card">
              <div class="adm-card-head"><h3>Фото ({{ d.images.length }})</h3><span class="adm-hint">Перше фото — головне. Друге показується при наведенні.</span></div>
              <div class="adm-card-body adm-stack" style="gap:12px">
                @if (d.images.length) {
                  <div class="images" cdkDropList cdkDropListOrientation="mixed" (cdkDropListDropped)="dropImage($event)">
                    @for (img of d.images; track img.url; let i = $index) {
                      <div class="img" cdkDrag>
                        <img [src]="img.url" alt="" />
                        @if (i === 0) { <span class="main-tag">Головне</span> }
                        <button class="rm" (click)="removeImage(i)" title="Видалити"><app-icon name="close" [size]="14" /></button>
                        @if (colors().length > 1) {
                          <select class="img-color" [(ngModel)]="img.color" (ngModelChange)="touch()" title="Фото для кольору">
                            <option [ngValue]="null">Усі кольори</option>
                            @for (c of colors(); track c) { <option [ngValue]="c">{{ c }}</option> }
                          </select>
                        }
                      </div>
                    }
                  </div>
                }
                <adm-image-upload label="Додати фото" (uploaded)="addImages($event)" />
                <div class="adm-row">
                  <input class="input" style="flex:1" [(ngModel)]="imageUrl" placeholder="або вставте посилання на фото" />
                  <button class="btn btn-ghost btn-sm" [disabled]="!imageUrl.trim()" (click)="addImages([imageUrl.trim()]); imageUrl = ''">Додати</button>
                </div>
              </div>
            </div>

            <div class="adm-card">
              <div class="adm-card-head"><h3>Розміри, кольори й залишки</h3><span class="adm-hint">{{ d.variants.length }} варіантів · {{ totalStock() }} шт.</span></div>
              <div class="adm-card-body adm-stack" style="gap:14px">
                <div class="gen">
                  <div class="field">
                    <label class="label">Розміри</label>
                    <div class="chips">
                      @for (s of sizePresets; track s) { <button class="chip" [class.active]="genSizes().has(s)" (click)="toggleGen(genSizes, s)">{{ s }}</button> }
                    </div>
                  </div>
                  <div class="field">
                    <label class="label">Кольори</label>
                    <div class="chips">
                      @for (c of colorPresets; track c[0]) {
                        <button class="chip" [class.active]="genColors().has(c[0])" (click)="toggleGen(genColors, c[0])"><span class="sw" [style.background]="c[1]"></span>{{ c[0] }}</button>
                      }
                    </div>
                    <div class="adm-row" style="margin-top:6px">
                      <input class="input" style="width:180px;flex:none" [(ngModel)]="customColor" placeholder="Свій колір" />
                      <input type="color" [(ngModel)]="customHex" class="hex" />
                      <button class="btn btn-ghost btn-xs" [disabled]="!customColor.trim()" (click)="addCustomColor()">Додати колір</button>
                    </div>
                  </div>
                  <div class="adm-row">
                    <label class="small">Кількість кожного: <input class="input qty" type="number" min="0" [(ngModel)]="genStock" /></label>
                    <button class="btn btn-sm" [disabled]="!genSizes().size && !genColors().size" (click)="generate()">Згенерувати варіанти</button>
                    <span class="adm-hint">Існуючі комбінації не дублюються</span>
                  </div>
                </div>

                @if (d.variants.length) {
                  <div class="adm-table-wrap">
                    <table class="adm-table variants">
                      <thead><tr><th>Колір</th><th>Розмір</th><th>Артикул</th><th class="num">Залишок</th><th class="num">Ціна ₴</th><th></th></tr></thead>
                      <tbody>
                        @for (v of d.variants; track $index; let i = $index) {
                          <tr [class.zero]="v.stock === 0">
                            <td data-label="Колір"><div class="adm-row" style="gap:6px;flex-wrap:nowrap">
                              <input type="color" class="hex" [ngModel]="v.color_hex || '#cccccc'" (ngModelChange)="v.color_hex = $event; touch()" />
                              <input class="input sm" [(ngModel)]="v.color" (ngModelChange)="touch()" placeholder="—" />
                            </div></td>
                            <td data-label="Розмір"><input class="input sm w70" [(ngModel)]="v.size" (ngModelChange)="touch()" placeholder="—" /></td>
                            <td data-label="Артикул"><input class="input sm" [(ngModel)]="v.sku" (ngModelChange)="touch()" /></td>
                            <td class="num" data-label="Залишок">
                              <div class="stepper">
                                <button (click)="v.stock = max0(v.stock - 1); touch()">−</button>
                                <input type="number" min="0" [(ngModel)]="v.stock" (ngModelChange)="touch()" />
                                <button (click)="v.stock = +v.stock + 1; touch()">+</button>
                              </div>
                            </td>
                            <td class="num" data-label="Ціна"><input class="input sm w90" type="number" min="0" [(ngModel)]="v.price" (ngModelChange)="touch()" [placeholder]="d.price" /></td>
                            <td><button class="icon-btn" (click)="removeVariant(i)" title="Видалити"><app-icon name="trash" [size]="15" /></button></td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
                <button class="btn btn-ghost btn-sm" style="align-self:flex-start" (click)="addVariant()"><app-icon name="plus" [size]="14" /> Додати рядок</button>
              </div>
            </div>
          </div>

          <div class="adm-stack side">
            <div class="adm-card pad adm-stack" style="gap:12px">
              <label class="adm-switch"><input type="checkbox" [(ngModel)]="d.is_active" (ngModelChange)="touch()" /><span class="track"></span> Показувати на сайті</label>
              <label class="adm-switch"><input type="checkbox" [(ngModel)]="d.is_featured" (ngModelChange)="touch()" /><span class="track"></span> На головній («Обрані речі»)</label>
              <label class="adm-switch"><input type="checkbox" [(ngModel)]="d.is_new" (ngModelChange)="touch()" /><span class="track"></span> Позначка «New»</label>
            </div>
            <div class="adm-card pad adm-stack" style="gap:12px">
              <div class="field"><label class="label">Ціна, ₴ *</label><input class="input" type="number" min="0" [(ngModel)]="d.price" (ngModelChange)="touch()" /></div>
              <div class="field"><label class="label">Стара ціна, ₴ (для знижки)</label><input class="input" type="number" min="0" [(ngModel)]="d.old_price" (ngModelChange)="touch()" placeholder="—" />
                @if (discount() > 0) { <div class="adm-hint">Знижка −{{ discount() }}% буде показана на сайті</div> }</div>
            </div>
            <div class="adm-card pad adm-stack" style="gap:12px">
              <div class="field"><label class="label">Категорія</label>
                <select class="select" [(ngModel)]="d.category_id" (ngModelChange)="touch()">
                  <option [ngValue]="null">— Без категорії —</option>
                  @for (c of categories(); track c.id) { <option [ngValue]="c.id">{{ c.label }}</option> }
                </select></div>
              <div class="field"><label class="label">Артикул</label><input class="input" [(ngModel)]="d.sku" (ngModelChange)="touch()" /></div>
              <div class="field"><label class="label">Адреса на сайті (slug)</label><input class="input" [(ngModel)]="d.slug" (ngModelChange)="touch()" placeholder="генерується з назви" /></div>
              <div class="field"><label class="label">Теги для пошуку (через кому)</label><input class="input" [ngModel]="d.tags.join(', ')" (ngModelChange)="d.tags = splitTags($event); touch()" placeholder="льон, літо" /></div>
            </div>
            @if (!isNew()) {
              <button class="btn btn-ghost btn-sm danger" (click)="remove()"><app-icon name="trash" [size]="14" /> Видалити товар</button>
            }
          </div>
        </div>

        <div class="adm-sticky-bar">
          @if (dirty()) { <span class="small adm-muted">Є незбережені зміни</span> }
          <a routerLink="/admin/products" class="btn btn-ghost btn-sm">Скасувати</a>
          <button class="btn btn-sm" [disabled]="busy()" (click)="save()">{{ busy() ? 'Збереження…' : 'Зберегти' }}</button>
        </div>
      } @else {
        <div class="adm-empty"><span class="spinner"></span></div>
      }
    </div>
  `,
  styles: `
    .images { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px; }
    .img { position: relative; aspect-ratio: 3 / 4; border-radius: 8px; overflow: hidden; background: var(--surface-2); cursor: grab; border: 1px solid var(--line); }
    .img img { width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
    .main-tag { position: absolute; left: 6px; top: 6px; background: var(--ink); color: var(--bg); font-size: 10px; padding: 2px 6px; border-radius: 4px; }
    .rm { position: absolute; right: 6px; top: 6px; width: 24px; height: 24px; border-radius: 50%; border: 0; background: rgba(255,255,255,.9); display: grid; place-items: center; }
    .img-color { position: absolute; left: 4px; right: 4px; bottom: 4px; font-size: 11px; padding: 3px; border-radius: 4px; border: 1px solid var(--line); background: rgba(255,255,255,.95); }
    .cdk-drag-preview { border-radius: 8px; overflow: hidden; box-shadow: var(--shadow-lg); }
    .cdk-drag-placeholder { opacity: .3; }
    .gen { background: #fbfaf7; border: 1px solid var(--line); border-radius: 8px; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chips .chip { min-height: 30px; font-size: 12px; padding: 0 10px; }
    .sw { width: 12px; height: 12px; border-radius: 50%; border: 1px solid rgba(0,0,0,.15); }
    .hex { width: 34px; height: 34px; padding: 0; border: 1px solid var(--line-strong); border-radius: 6px; background: none; cursor: pointer; flex-shrink: 0; }
    .qty { width: 70px !important; min-height: 32px !important; display: inline-block; margin-left: 6px; }
    .variants .input.sm { min-height: 34px; padding: 6px 8px; }
    .w70 { width: 70px; } .w90 { width: 90px; }
    .variants tr.zero td { background: #fdf8f6; }
    .stepper { display: inline-flex; align-items: center; border: 1px solid var(--line-strong); border-radius: 6px; overflow: hidden; }
    .stepper button { width: 28px; height: 32px; border: 0; background: var(--surface-2); }
    .stepper input { width: 48px; height: 32px; border: 0; text-align: center; outline: none; -moz-appearance: textfield; }
    .danger { color: var(--danger); align-self: flex-start; }
    @media (min-width: 1200px) { .side { position: sticky; top: 76px; } }
  `,
})
export class ProductEditorPage implements HasUnsavedChanges {
  private api = inject(AdminApi);
  private router = inject(Router);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  readonly id = input<string>();

  protected sizePresets = SIZE_PRESETS;
  protected colorPresets = [...COLOR_PRESETS];
  protected p = signal<AdminProduct>(blank());
  protected loaded = signal(false);
  protected busy = signal(false);
  protected version = signal(0);
  protected categories = signal<{ id: number; label: string }[]>([]);
  protected genSizes = signal(new Set<string>(['XS', 'S', 'M', 'L', 'XL']));
  protected genColors = signal(new Set<string>());
  protected genStock = 1;
  protected customColor = '';
  protected customHex = '#888888';
  protected imageUrl = '';
  private savedJson = '';

  protected isNew = computed(() => !this.id() || this.id() === 'new');
  protected totalStock = computed(() => { this.version(); return this.p().variants.reduce((s, v) => s + (Number(v.stock) || 0), 0); });
  protected colors = computed(() => { this.version(); return [...new Set(this.p().variants.map((v) => v.color).filter(Boolean))]; });
  protected discount = computed(() => {
    this.version();
    const p = this.p();
    return p.old_price && p.old_price > p.price ? Math.round((1 - p.price / p.old_price) * 100) : 0;
  });
  protected dirty = computed(() => { this.version(); return this.loaded() && JSON.stringify(this.p()) !== this.savedJson; });

  constructor() {
    this.api.get<Category[]>('/categories').subscribe((t) => this.categories.set(flattenCategories(t)));
    effect(() => {
      if (this.isNew()) {
        this.p.set(blank());
        this.savedJson = JSON.stringify(this.p());
        this.loaded.set(true);
        return;
      }
      this.loaded.set(false);
      this.api.get<AdminProduct & { id: number }>(`/products/${this.id()}`).subscribe({
        next: (r) => {
          const prod: AdminProduct = {
            id: r.id, name: r.name, slug: r.slug, category_id: r.category_id, sku: r.sku, description: r.description,
            composition: r.composition, care: r.care, price: r.price, old_price: r.old_price, is_active: r.is_active,
            is_featured: r.is_featured, is_new: r.is_new, tags: r.tags ?? [], images: r.images, variants: r.variants,
          };
          this.p.set(prod);
          this.savedJson = JSON.stringify(prod);
          this.genColors.set(new Set());
          this.loaded.set(true);
          this.version.update((v) => v + 1);
        },
        error: (e) => this.toasts.error(errorMessage(e)),
      });
    });
  }

  hasUnsavedChanges() {
    return this.dirty() && !this.busy();
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(e: BeforeUnloadEvent) {
    if (this.hasUnsavedChanges()) e.preventDefault();
  }

  touch() {
    this.version.update((v) => v + 1);
  }

  max0(n: number) {
    return Math.max(0, Number(n) - 0);
  }

  splitTags(v: string) {
    return v.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  }

  toggleGen(sig: typeof this.genSizes, v: string) {
    sig.update((s) => {
      const n = new Set(s);
      n.has(v) ? n.delete(v) : n.add(v);
      return n;
    });
  }

  addCustomColor() {
    const name = this.customColor.trim();
    if (!this.colorPresets.some((c) => c[0] === name)) this.colorPresets.push([name, this.customHex]);
    this.toggleGen(this.genColors, name);
    this.customColor = '';
  }

  generate() {
    const sizes = this.genSizes().size ? SIZE_PRESETS.filter((s) => this.genSizes().has(s)) : [''];
    const colors = this.genColors().size ? this.colorPresets.filter((c) => this.genColors().has(c[0])) : [['', null] as [string, string | null]];
    const p = this.p();
    const exists = new Set(p.variants.map((v) => `${v.color}|${v.size}`));
    let added = 0;
    for (const [color, hex] of colors) {
      for (const size of sizes) {
        if (exists.has(`${color}|${size}`)) continue;
        p.variants.push({ size, color, color_hex: hex, sku: p.sku ? `${p.sku}-${size || color}`.toUpperCase() : '', stock: Number(this.genStock) || 0, price: null });
        added++;
      }
    }
    this.touch();
    this.toasts.show(added ? `Додано варіантів: ${added}` : 'Усі ці комбінації вже є');
  }

  addVariant() {
    this.p().variants.push({ size: '', color: '', color_hex: null, sku: '', stock: 0, price: null });
    this.touch();
  }

  removeVariant(i: number) {
    this.p().variants.splice(i, 1);
    this.touch();
  }

  addImages(urls: string[]) {
    const p = this.p();
    for (const url of urls) if (!p.images.some((i) => i.url === url)) p.images.push({ url, alt: '', color: null });
    this.touch();
  }

  removeImage(i: number) {
    this.p().images.splice(i, 1);
    this.touch();
  }

  dropImage(e: CdkDragDrop<unknown>) {
    moveItemInArray(this.p().images, e.previousIndex, e.currentIndex);
    this.touch();
  }

  save() {
    const p = this.p();
    if (!p.name.trim()) return this.toasts.error('Вкажіть назву товару');
    if (!(Number(p.price) >= 0)) return this.toasts.error('Вкажіть ціну');
    if (!p.variants.length) return this.toasts.error('Додайте хоча б один варіант (розмір / колір)');
    const body = {
      ...p,
      id: undefined,
      slug: p.slug.trim() || undefined,
      price: Number(p.price),
      old_price: p.old_price === null || (p.old_price as unknown) === '' ? null : Number(p.old_price),
      variants: p.variants.map((v) => ({ ...v, stock: Number(v.stock) || 0, price: v.price === null || (v.price as unknown) === '' ? null : Number(v.price), color_hex: v.color_hex || null })),
    };
    this.busy.set(true);
    const req = this.isNew() ? this.api.post<{ id: number }>('/products', body) : this.api.put<{ id: number }>(`/products/${p.id}`, body);
    req.subscribe({
      next: (r) => {
        this.busy.set(false);
        this.savedJson = JSON.stringify(this.p());
        this.touch();
        this.toasts.success('Товар збережено');
        if (this.isNew()) this.router.navigate(['/admin/products', r.id], { replaceUrl: true });
        else this.api.get<AdminProduct>(`/products/${p.id}`).subscribe((fresh) => {
          // pick up ids of newly created variants so later saves update them in place
          this.p.update((cur) => ({ ...cur, slug: fresh.slug, variants: fresh.variants }));
          this.savedJson = JSON.stringify(this.p());
          this.touch();
        });
      },
      error: (e) => {
        this.busy.set(false);
        this.toasts.error(errorMessage(e));
      },
    });
  }

  duplicate() {
    this.api.post<{ id: number }>(`/products/${this.p().id}/duplicate`).subscribe({
      next: (r) => {
        this.toasts.success('Копію створено (прихована)');
        this.savedJson = JSON.stringify(this.p());
        this.router.navigate(['/admin/products', r.id]);
      },
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }

  async remove() {
    if (!(await this.confirm.ask(`Видалити «${this.p().name}»? Замовлення з цим товаром збережуться.`, { danger: true, confirmLabel: 'Видалити' }))) return;
    this.api.delete(`/products/${this.p().id}`).subscribe(() => {
      this.savedJson = JSON.stringify(this.p());
      this.touch();
      this.router.navigate(['/admin/products']);
    });
  }
}
