import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { errorMessage } from '../../../core/api.service';
import type { Banner, FaqItem } from '../../../core/models';
import { Toasts } from '../../../core/toast.service';
import { Icon } from '../../../shared/icon';
import { AdminApi } from '../../admin-api';
import { Confirm } from '../../ui/confirm';
import { ImageUpload } from '../../ui/image-upload';
import { Modal } from '../../ui/modal';

type BannerDraft = Omit<Banner, 'id'> & { id?: number };
type FaqDraft = Omit<FaqItem, 'id'> & { id?: number };

@Component({
  selector: 'app-admin-content',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, CdkDropList, CdkDrag, CdkDragHandle, Icon, Modal, ImageUpload],
  template: `
    <div class="adm-page">
      <div class="adm-page-head">
        <div><h1>Контент</h1><div class="sub">Банери на головній та питання-відповіді</div></div>
        <div class="adm-seg">
          <button [class.active]="tab() === 'banners'" (click)="tab.set('banners')">Банери</button>
          <button [class.active]="tab() === 'faq'" (click)="tab.set('faq')">FAQ / чат-бот</button>
        </div>
      </div>

      @if (tab() === 'banners') {
        <div class="adm-between" style="margin-bottom:12px">
          <p class="adm-hint" style="margin:0">Слайди у верхній частині головної. Перетягуйте, щоб змінити порядок.</p>
          <button class="btn btn-sm" (click)="editBanner(null)"><app-icon name="plus" [size]="15" /> Додати банер</button>
        </div>
        <div class="banners" cdkDropList (cdkDropListDropped)="dropBanner($event)">
          @for (b of banners(); track b.id) {
            <div class="adm-card banner" cdkDrag>
              <span class="handle" cdkDragHandle><app-icon name="drag" [size]="18" /></span>
              <img [src]="b.image_url" alt="" />
              <div class="info">
                <b>{{ b.title || 'Без заголовка' }}</b>
                <div class="small adm-muted">{{ b.subtitle }}</div>
                <div class="tiny adm-muted">{{ b.button_text }} → {{ b.link || '—' }}</div>
              </div>
              <span class="adm-pill" [class.ok]="b.is_active">{{ b.is_active ? 'Показується' : 'Приховано' }}</span>
              <button class="icon-btn" (click)="editBanner(b)"><app-icon name="edit" [size]="16" /></button>
              <button class="icon-btn" (click)="removeBanner(b)"><app-icon name="trash" [size]="16" /></button>
            </div>
          } @empty {
            <div class="adm-card adm-empty"><app-icon name="image" [size]="36" /><div class="t">Банерів немає</div><div>На головній буде показано стандартний блок</div></div>
          }
        </div>
      } @else {
        <div class="adm-between" style="margin-bottom:12px">
          <p class="adm-hint" style="margin:0">Ці відповіді показуються на сторінці FAQ і їх використовує чат-бот, тож пишіть точно й актуально.</p>
          <button class="btn btn-sm" (click)="editFaq(null)"><app-icon name="plus" [size]="15" /> Додати питання</button>
        </div>
        <div class="adm-card" cdkDropList (cdkDropListDropped)="dropFaq($event)">
          @for (f of faq(); track f.id) {
            <div class="faq" cdkDrag>
              <span class="handle" cdkDragHandle><app-icon name="drag" [size]="18" /></span>
              <div class="info" (click)="editFaq(f)">
                <b>{{ f.question }}</b>
                <div class="small adm-muted clamp">{{ f.answer }}</div>
              </div>
              @if (!f.is_active) { <span class="adm-pill">Приховано</span> }
              <button class="icon-btn" (click)="removeFaq(f)"><app-icon name="trash" [size]="16" /></button>
            </div>
          } @empty {
            <div class="adm-empty">Питань ще немає</div>
          }
        </div>
      }
    </div>

    @if (banner(); as b) {
      <adm-modal [title]="b.id ? 'Редагувати банер' : 'Новий банер'" width="640px" (close)="banner.set(null)">
        <div class="adm-stack" style="gap:12px">
          @if (b.image_url) {
            <div class="preview" [style.background-image]="'url(' + b.image_url + ')'">
              <div><div class="pt">{{ b.title }}</div><div class="ps">{{ b.subtitle }}</div></div>
            </div>
          }
          <adm-image-upload [multiple]="false" label="Завантажити зображення (горизонтальне, від 1600px)" (uploaded)="b.image_url = $event[0]" />
          <div class="form-grid">
            <div class="field full"><label class="label">Заголовок</label><input class="input" [(ngModel)]="b.title" /></div>
            <div class="field full"><label class="label">Підзаголовок</label><input class="input" [(ngModel)]="b.subtitle" /></div>
            <div class="field"><label class="label">Текст кнопки</label><input class="input" [(ngModel)]="b.button_text" placeholder="Дивитися" /></div>
            <div class="field"><label class="label">Посилання</label><input class="input" [(ngModel)]="b.link" placeholder="/catalog/sukni" /></div>
            <div class="field full"><label class="label">Або URL зображення</label><input class="input" [(ngModel)]="b.image_url" /></div>
            <label class="adm-switch"><input type="checkbox" [(ngModel)]="b.is_active" /><span class="track"></span> Показувати</label>
          </div>
        </div>
        <ng-container foot>
          <button class="btn btn-ghost btn-sm" (click)="banner.set(null)">Скасувати</button>
          <button class="btn btn-sm" [disabled]="!b.image_url" (click)="saveBanner(b)">Зберегти</button>
        </ng-container>
      </adm-modal>
    }

    @if (faqDraft(); as f) {
      <adm-modal [title]="f.id ? 'Редагувати питання' : 'Нове питання'" (close)="faqDraft.set(null)">
        <div class="adm-stack" style="gap:12px">
          <div class="field"><label class="label">Питання</label><input class="input" [(ngModel)]="f.question" /></div>
          <div class="field"><label class="label">Відповідь</label><textarea class="textarea" rows="6" [(ngModel)]="f.answer"></textarea></div>
          <label class="adm-switch"><input type="checkbox" [(ngModel)]="f.is_active" /><span class="track"></span> Показувати</label>
        </div>
        <ng-container foot>
          <button class="btn btn-ghost btn-sm" (click)="faqDraft.set(null)">Скасувати</button>
          <button class="btn btn-sm" [disabled]="!f.question || !f.answer" (click)="saveFaq(f)">Зберегти</button>
        </ng-container>
      </adm-modal>
    }
  `,
  styles: `
    .banners { display: flex; flex-direction: column; gap: 10px; }
    .banner, .faq { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: var(--surface); }
    .faq { border-bottom: 1px solid var(--line); }
    .banner img { width: 120px; height: 64px; object-fit: cover; border-radius: 6px; background: var(--surface-2); }
    .info { flex: 1; min-width: 0; cursor: pointer; }
    .clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .handle { cursor: grab; color: var(--muted); display: grid; }
    .cdk-drag-preview { box-shadow: var(--shadow-lg); border-radius: 10px; }
    .cdk-drag-placeholder { opacity: .3; }
    .preview { aspect-ratio: 16 / 6; background-size: cover; background-position: center; border-radius: 8px; display: flex; align-items: flex-end; padding: 16px; color: var(--ink); }
    .pt { font-family: var(--font-serif); font-size: 26px; }
    .ps { font-size: 13px; }
    @media (max-width: 599px) { .banner img { width: 72px; height: 48px; } .banner .adm-pill { display: none; } }
  `,
})
export class ContentPage {
  private api = inject(AdminApi);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  protected tab = signal<'banners' | 'faq'>('banners');
  protected banners = signal<Banner[]>([]);
  protected faq = signal<FaqItem[]>([]);
  protected banner = signal<BannerDraft | null>(null);
  protected faqDraft = signal<FaqDraft | null>(null);

  constructor() {
    this.load();
  }

  load() {
    this.api.get<Banner[]>('/banners').subscribe((r) => this.banners.set(r));
    this.api.get<FaqItem[]>('/faq').subscribe((r) => this.faq.set(r));
  }

  private done = {
    next: () => {
      this.toasts.success('Збережено');
      this.load();
    },
    error: (e: unknown) => this.toasts.error(errorMessage(e)),
  };

  editBanner(b: Banner | null) {
    this.banner.set(b ? { ...b } : { title: '', subtitle: '', image_url: '', link: '/catalog', button_text: 'Дивитися', sort_order: this.banners().length, is_active: true });
  }
  saveBanner(b: BannerDraft) {
    const { id, ...body } = b;
    (id ? this.api.put(`/banners/${id}`, body) : this.api.post('/banners', body)).subscribe(this.done);
    this.banner.set(null);
  }
  async removeBanner(b: Banner) {
    if (await this.confirm.ask('Видалити банер?', { danger: true, confirmLabel: 'Видалити' })) this.api.delete(`/banners/${b.id}`).subscribe(this.done);
  }
  dropBanner(e: CdkDragDrop<Banner[]>) {
    const list = [...this.banners()];
    moveItemInArray(list, e.previousIndex, e.currentIndex);
    this.banners.set(list);
    list.forEach((b, i) => {
      const { id, ...body } = b;
      if (b.sort_order !== i) this.api.put(`/banners/${id}`, { ...body, sort_order: i }).subscribe();
    });
  }

  editFaq(f: FaqItem | null) {
    this.faqDraft.set(f ? { ...f } : { question: '', answer: '', sort_order: this.faq().length, is_active: true });
  }
  saveFaq(f: FaqDraft) {
    const { id, ...body } = f;
    (id ? this.api.put(`/faq/${id}`, body) : this.api.post('/faq', body)).subscribe(this.done);
    this.faqDraft.set(null);
  }
  async removeFaq(f: FaqItem) {
    if (await this.confirm.ask('Видалити це питання?', { danger: true, confirmLabel: 'Видалити' })) this.api.delete(`/faq/${f.id}`).subscribe(this.done);
  }
  dropFaq(e: CdkDragDrop<FaqItem[]>) {
    const list = [...this.faq()];
    moveItemInArray(list, e.previousIndex, e.currentIndex);
    this.faq.set(list);
    list.forEach((f, i) => {
      const { id, ...body } = f;
      if (f.sort_order !== i) this.api.put(`/faq/${id}`, { ...body, sort_order: i }).subscribe();
    });
  }
}
