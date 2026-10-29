import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { errorMessage } from '../../../core/api.service';
import type { Category } from '../../../core/models';
import { Toasts } from '../../../core/toast.service';
import { Icon } from '../../../shared/icon';
import { AdminApi, flattenCategories } from '../../admin-api';
import { Confirm } from '../../ui/confirm';
import { ImageUpload } from '../../ui/image-upload';
import { Modal } from '../../ui/modal';

interface Draft {
  id?: number;
  name: string;
  slug: string;
  parent_id: number | null;
  description: string;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
  show_in_menu: boolean;
}

function countAll(c: Category): number {
  return (c.product_count ?? 0) + c.children.reduce((s, x) => s + countAll(x), 0);
}

@Component({
  selector: 'app-admin-categories',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, NgTemplateOutlet, CdkDropList, CdkDrag, CdkDragHandle, Icon, Modal, ImageUpload],
  template: `
    <div class="adm-page">
      <div class="adm-page-head">
        <div><h1>Категорії</h1><div class="sub">Дерево каталогу з будь-якою вкладеністю. Перетягуйте за ⠿, щоб змінити порядок.</div></div>
        <div class="actions"><button class="btn btn-sm" (click)="add(null)"><app-icon name="plus" [size]="15" /> Нова категорія</button></div>
      </div>

      <div class="adm-card tree">
        <ng-container *ngTemplateOutlet="level; context: { $implicit: tree(), depth: 0 }" />
        @if (!tree().length) {
          <div class="adm-empty"><app-icon name="layers" [size]="36" /><div class="t">Категорій ще немає</div><div>Створіть першу, наприклад «Сукні»</div></div>
        }
      </div>
    </div>

    <ng-template #level let-list let-depth="depth">
      <div cdkDropList [cdkDropListData]="list" (cdkDropListDropped)="drop($event)" class="level">
        @for (c of list; track c.id) {
          <div cdkDrag class="node">
            <div class="row" [style.padding-left.px]="14 + depth * 26">
              <span class="handle" cdkDragHandle><app-icon name="drag" [size]="16" /></span>
              @if (c.children.length) {
                <button class="icon-btn tiny-btn" (click)="toggle(c.id)"><app-icon [name]="collapsed().has(c.id) ? 'chevron-right' : 'chevron-down'" [size]="15" /></button>
              } @else { <span class="tiny-btn"></span> }
              @if (c.image_url) { <img [src]="c.image_url" class="adm-thumb-sm" alt="" /> }
              <div class="name" (click)="edit(c)">
                <b [class.off]="!c.is_active">{{ c.name }}</b>
                <span class="tiny adm-muted">/{{ c.slug }}</span>
              </div>
              <span class="adm-pill" title="Товарів у категорії та підкатегоріях">{{ total(c) }} тов.</span>
              @if (!c.is_active) { <span class="adm-pill">Приховано</span> } @else if (!c.show_in_menu) { <span class="adm-pill">Не в меню</span> }
              <div class="acts">
                <button class="btn btn-ghost btn-xs" (click)="add(c)" title="Додати підкатегорію"><app-icon name="plus" [size]="13" /> Підкатегорія</button>
                <a class="icon-btn" [href]="'/catalog/' + c.slug" target="_blank" title="На сайті"><app-icon name="eye" [size]="15" /></a>
                <button class="icon-btn" (click)="edit(c)" title="Редагувати"><app-icon name="edit" [size]="15" /></button>
              </div>
            </div>
            @if (c.children.length && !collapsed().has(c.id)) {
              <ng-container *ngTemplateOutlet="level; context: { $implicit: c.children, depth: depth + 1 }" />
            }
          </div>
        }
      </div>
    </ng-template>

    @if (draft(); as d) {
      <adm-modal [title]="d.id ? 'Редагувати категорію' : 'Нова категорія'" (close)="draft.set(null)">
        <div class="form-grid">
          <div class="field full"><label class="label">Назва</label><input class="input" [(ngModel)]="d.name" (ngModelChange)="autoSlug(d)" /></div>
          <div class="field"><label class="label">Батьківська категорія</label>
            <select class="select" [ngModel]="d.parent_id" (ngModelChange)="d.parent_id = $event === 'null' || $event === null ? null : +$event">
              <option [ngValue]="null">— Верхній рівень —</option>
              @for (o of parentOptions(d.id); track o.id) { <option [ngValue]="o.id">{{ o.label }}</option> }
            </select></div>
          <div class="field"><label class="label">Адреса (slug)</label><input class="input" [(ngModel)]="d.slug" placeholder="генерується автоматично" /></div>
          <div class="field full"><label class="label">Опис (показується над товарами)</label><textarea class="textarea" rows="3" [(ngModel)]="d.description"></textarea></div>
          <div class="field full">
            <label class="label">Зображення (для плиток на головній)</label>
            <div class="adm-row" style="align-items:stretch">
              @if (d.image_url) { <img [src]="d.image_url" class="cat-img" alt="" /> }
              <div style="flex:1"><adm-image-upload [multiple]="false" label="Завантажити" (uploaded)="d.image_url = $event[0]" /></div>
            </div>
            @if (d.image_url) { <button class="btn btn-ghost btn-xs" style="align-self:flex-start" (click)="d.image_url = null">Прибрати фото</button> }
          </div>
          <label class="adm-switch"><input type="checkbox" [(ngModel)]="d.is_active" /><span class="track"></span> Показувати на сайті</label>
          <label class="adm-switch"><input type="checkbox" [(ngModel)]="d.show_in_menu" /><span class="track"></span> Показувати в меню</label>
        </div>
        <ng-container foot>
          @if (d.id) { <button class="btn btn-ghost btn-sm" style="margin-right:auto;color:var(--danger)" (click)="remove(d)">Видалити</button> }
          <button class="btn btn-ghost btn-sm" (click)="draft.set(null)">Скасувати</button>
          <button class="btn btn-sm" [disabled]="!d.name.trim() || busy()" (click)="save(d)">Зберегти</button>
        </ng-container>
      </adm-modal>
    }
  `,
  styles: `
    .tree { overflow: hidden; }
    .row { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--line); background: var(--surface); min-height: 54px; }
    .row:hover { background: #fcfbf8; }
    .handle { cursor: grab; color: var(--muted); display: grid; }
    .tiny-btn { width: 26px !important; height: 26px !important; flex-shrink: 0; }
    .name { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; cursor: pointer; flex-wrap: wrap; }
    .name b.off { color: var(--muted); text-decoration: line-through; }
    .acts { display: flex; align-items: center; gap: 2px; }
    .cdk-drag-preview { box-shadow: var(--shadow-lg); border-radius: 8px; overflow: hidden; }
    .cdk-drag-placeholder { opacity: .35; }
    .cdk-drop-list-dragging .node:not(.cdk-drag-placeholder) { transition: transform .2s var(--ease); }
    .cat-img { width: 72px; height: 90px; object-fit: cover; border-radius: 6px; }
    @media (max-width: 699px) { .acts .btn { display: none; } .row .adm-pill { display: none; } }
  `,
})
export class CategoriesPage {
  private api = inject(AdminApi);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  protected tree = signal<Category[]>([]);
  protected collapsed = signal(new Set<number>());
  protected draft = signal<Draft | null>(null);
  protected busy = signal(false);
  private flat = computed(() => flattenCategories(this.tree()));
  protected total = countAll;
  private slugTouched = false;

  constructor() {
    this.load();
  }

  load() {
    this.api.get<Category[]>('/categories').subscribe((r) => this.tree.set(r));
  }

  toggle(id: number) {
    this.collapsed.update((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  /** Every category except the edited one and its descendants (no cycles). */
  parentOptions(id?: number) {
    if (!id) return this.flat();
    const banned = new Set<number>();
    const walk = (list: Category[], inside: boolean) => list.forEach((c) => {
      const isIn = inside || c.id === id;
      if (isIn) banned.add(c.id);
      walk(c.children, isIn);
    });
    walk(this.tree(), false);
    return this.flat().filter((o) => !banned.has(o.id));
  }

  add(parent: Category | null) {
    this.slugTouched = false;
    this.draft.set({ name: '', slug: '', parent_id: parent?.id ?? null, description: '', image_url: null, sort_order: (parent ? parent.children : this.tree()).length, is_active: true, show_in_menu: true });
  }

  edit(c: Category) {
    this.slugTouched = true;
    this.draft.set({ id: c.id, name: c.name, slug: c.slug, parent_id: c.parent_id, description: c.description, image_url: c.image_url, sort_order: c.sort_order, is_active: c.is_active, show_in_menu: c.show_in_menu });
  }

  autoSlug(d: Draft) {
    if (!d.id && !this.slugTouched) d.slug = '';
  }

  save(d: Draft) {
    this.busy.set(true);
    const { id, ...body } = d;
    const req = id ? this.api.put(`/categories/${id}`, body) : this.api.post('/categories', { ...body, slug: body.slug || undefined });
    req.subscribe({
      next: () => {
        this.busy.set(false);
        this.draft.set(null);
        this.toasts.success('Категорію збережено');
        this.load();
      },
      error: (e) => {
        this.busy.set(false);
        this.toasts.error(errorMessage(e));
      },
    });
  }

  async remove(d: Draft) {
    const ok = await this.confirm.ask(
      `Видалити «${d.name}» разом з усіма підкатегоріями? Товари не видаляться — вони стануть «без категорії», їх можна буде перенести.`,
      { danger: true, confirmLabel: 'Видалити' },
    );
    if (!ok) return;
    this.api.delete(`/categories/${d.id}`).subscribe({
      next: () => {
        this.draft.set(null);
        this.load();
      },
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }

  drop(e: CdkDragDrop<Category[]>) {
    if (e.previousIndex === e.currentIndex) return;
    const list = e.container.data;
    moveItemInArray(list, e.previousIndex, e.currentIndex);
    this.tree.update((t) => [...t]);
    const payload = list.map((c, i) => ({ id: c.id, parent_id: c.parent_id, sort_order: i }));
    this.api.post('/categories/reorder', payload).subscribe({
      next: () => this.toasts.success('Порядок збережено'),
      error: (err) => {
        this.toasts.error(errorMessage(err));
        this.load();
      },
    });
  }
}
