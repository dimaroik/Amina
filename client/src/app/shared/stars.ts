import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Read-only star rating; supports fractions (e.g. 4.6). */
@Component({
  selector: 'app-stars',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'img', '[attr.aria-label]': "'Оцінка ' + value() + ' з 5'" },
  template: `
    <span class="track" [style.font-size.px]="size()">
      ★★★★★<span class="fill" [style.width.%]="percent()">★★★★★</span>
    </span>
  `,
  styles: `
    :host { display: inline-flex; line-height: 1; }
    .track { position: relative; color: var(--line-strong); letter-spacing: 2px; white-space: nowrap; }
    .fill { position: absolute; inset: 0 auto 0 0; overflow: hidden; color: var(--ink); }
  `,
})
export class Stars {
  readonly value = input(0);
  readonly size = input(14);
  protected percent = computed(() => Math.max(0, Math.min(100, (this.value() / 5) * 100)));
}
