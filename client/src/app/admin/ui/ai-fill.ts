import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api.service';
import { Icon } from '../../shared/icon';
import { AdminApi, type ProductDraft } from '../admin-api';

let aiStatus: Promise<boolean> | null = null;

/**
 * «Заповнити з ШІ»: supplier text (Chinese is fine) + the product photos → Ukrainian name,
 * description, composition, care, category, colours and sizes.
 */
@Component({
  selector: 'adm-ai-fill',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon],
  template: `
    <div class="ai" [class.open]="open()">
      <button type="button" class="ai-head" (click)="open.set(!open())">
        <span class="spark"><app-icon name="sparkle" [size]="16" /></span>
        <span class="grow">
          <b>Заповнити з ШІ</b>
          <span class="adm-hint">Вставте опис з Taobao / 1688 (можна китайською) і додайте фото — ШІ напише назву, опис, склад і підбере категорію, кольори й розміри.</span>
        </span>
        <app-icon [name]="open() ? 'chevron-up' : 'chevron-down'" [size]="16" />
      </button>
      @if (open()) {
        <div class="ai-body">
          @if (enabled() === false) {
            <p class="adm-hint" style="margin:0">ШІ ще не підключено. Додайте змінну <code>ANTHROPIC_API_KEY</code> у налаштуваннях сервісу на Render — той самий ключ використовує чат-бот.</p>
          } @else {
            <textarea class="textarea" rows="4" [(ngModel)]="text" placeholder="Напр.: 2024秋冬新款 韩版宽松针织开衫女 V领 纯色 毛衣外套 ... 面料: 60%棉 40%聚酯纤维 尺码: S M L XL 颜色: 米白 咖啡 黑色"></textarea>
            <div class="adm-row">
              <span class="adm-hint grow">
                @if (images().length) { Фото: {{ images().length > 4 ? 'перші 4 з ' + images().length : images().length }} } @else { Фото не додано — краще додати хоча б одне }
              </span>
              <button type="button" class="btn btn-sm" (click)="run()" [disabled]="busy() || (!text.trim() && !images().length)">
                @if (busy()) { <span class="spinner sm"></span> ШІ пише… } @else { <app-icon name="sparkle" [size]="14" /> Згенерувати }
              </button>
            </div>
            @if (note()) { <div class="note" [class.err]="failed()">{{ note() }}</div> }
          }
        </div>
      }
    </div>
  `,
  styles: `
    .ai { border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line)); border-radius: var(--radius-lg);
      background: linear-gradient(135deg, color-mix(in srgb, var(--accent-soft) 35%, var(--surface)), var(--surface) 60%); }
    .ai-head { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px 14px; cursor: pointer; }
    .ai-head b { display: block; font-size: 14px; font-weight: 600; margin-bottom: 2px; }
    .ai-head .adm-hint { display: block; }
    .spark { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; flex: none; background: var(--ink); color: var(--bg); }
    .grow { flex: 1; min-width: 0; }
    .ai-body { display: flex; flex-direction: column; gap: 10px; padding: 0 14px 14px; }
    .note { font-size: 13px; padding: 8px 10px; border-radius: var(--radius); background: color-mix(in srgb, var(--success) 10%, var(--surface)); color: var(--ink-2); }
    .note.err { background: color-mix(in srgb, var(--danger) 9%, var(--surface)); color: var(--danger); }
    .spinner.sm { width: 14px; height: 14px; border-width: 2px; }
    code { font-size: 12px; }
  `,
})
export class AiFill {
  private api = inject(AdminApi);
  readonly images = input<string[]>([]);
  readonly colors = input.required<string[]>();
  readonly sizes = input.required<string[]>();
  readonly draft = output<ProductDraft>();

  protected open = signal(false);
  protected busy = signal(false);
  protected enabled = signal<boolean | null>(null);
  protected note = signal('');
  protected failed = signal(false);
  protected text = '';

  constructor() {
    aiStatus ??= new Promise((resolve) =>
      this.api.get<{ enabled: boolean }>('/ai/status').subscribe({ next: (r) => resolve(r.enabled), error: () => resolve(false) }),
    );
    aiStatus.then((v) => this.enabled.set(v));
  }

  run() {
    this.busy.set(true);
    this.note.set('');
    this.failed.set(false);
    this.api
      .post<ProductDraft>('/ai/product-draft', { text: this.text, images: this.images().slice(0, 4), colors: this.colors(), sizes: this.sizes() })
      .subscribe({
        next: (d) => {
          this.busy.set(false);
          this.draft.emit(d);
          this.note.set(`Готово — перевірте поля нижче.${d.notes ? ` ${d.notes}` : ''}`);
        },
        error: (e) => {
          this.busy.set(false);
          this.failed.set(true);
          this.note.set(errorMessage(e));
        },
      });
  }
}
