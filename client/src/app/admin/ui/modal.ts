import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'adm-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { '(document:keydown.escape)': 'close.emit()' },
  template: `
    <div class="adm-modal-backdrop" (click)="close.emit()">
      <div class="adm-modal" [style.--w]="width()" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
        <div class="adm-modal-head">
          <h3>{{ title() }}</h3>
          <button class="icon-btn" (click)="close.emit()" aria-label="Закрити"><app-icon name="close" /></button>
        </div>
        <div class="adm-modal-body"><ng-content /></div>
        <div class="adm-modal-foot"><ng-content select="[foot]" /></div>
      </div>
    </div>
  `,
})
export class Modal {
  readonly title = input('');
  readonly width = input('560px');
  readonly close = output<void>();
}
