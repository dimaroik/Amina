import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'adm-pager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="adm-pagination">
      <span>Всього: {{ total() }}</span>
      @if (pages() > 1) {
        <div class="adm-row">
          <button class="icon-btn" [disabled]="page() <= 1" (click)="go.emit(page() - 1)" aria-label="Назад"><app-icon name="chevron-left" /></button>
          <span>{{ page() }} / {{ pages() }}</span>
          <button class="icon-btn" [disabled]="page() >= pages()" (click)="go.emit(page() + 1)" aria-label="Далі"><app-icon name="chevron-right" /></button>
        </div>
      }
    </div>
  `,
})
export class Pager {
  readonly page = input(1);
  readonly pages = input(1);
  readonly total = input(0);
  readonly go = output<number>();
}
