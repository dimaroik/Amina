import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { errorMessage } from '../../core/api.service';
import { Toasts } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { AdminApi } from '../admin-api';

/** Drop zone that uploads images and emits their URLs. */
@Component({
  selector: 'adm-image-upload',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <label class="adm-dropzone" [class.over]="over()"
      (dragover)="$event.preventDefault(); over.set(true)" (dragleave)="over.set(false)" (drop)="onDrop($event)">
      <input type="file" accept="image/*" [multiple]="multiple()" hidden (change)="onPick($event)" />
      @if (busy()) {
        <span class="spinner"></span>
        <div class="small" style="margin-top:6px">Завантаження…</div>
      } @else {
        <app-icon name="upload" [size]="22" />
        <div class="small"><b>{{ label() }}</b></div>
        <div class="tiny">або перетягніть сюди · JPG, PNG, WebP до 15 МБ</div>
      }
    </label>
  `,
})
export class ImageUpload {
  private api = inject(AdminApi);
  private toasts = inject(Toasts);
  readonly multiple = input(true);
  readonly label = input('Оберіть фото');
  readonly uploaded = output<string[]>();
  protected over = signal(false);
  protected busy = signal(false);

  onPick(e: Event) {
    const el = e.target as HTMLInputElement;
    this.send(Array.from(el.files ?? []));
    el.value = '';
  }

  onDrop(e: DragEvent) {
    e.preventDefault();
    this.over.set(false);
    this.send(Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/')));
  }

  private send(files: File[]) {
    if (!files.length) return;
    this.busy.set(true);
    this.api.upload(this.multiple() ? files : files.slice(0, 1)).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.uploaded.emit(res.map((r) => r.url));
      },
      error: (err) => {
        this.busy.set(false);
        this.toasts.error(errorMessage(err, 'Не вдалося завантажити фото'));
      },
    });
  }
}
