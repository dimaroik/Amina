import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '../../../core/store.service';
import { Icon } from '../../../shared/icon';
import { INFO_STYLES } from './info-styles';

@Component({
  selector: 'app-faq',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <section class="container page">
      <div class="head">
        <span class="eyebrow">Допомога</span>
        <h1 class="h1">Питання та відповіді</h1>
        <p>Не знайшли відповідь? Напишіть нашій помічниці в чат унизу сторінки.</p>
      </div>
      <div class="list">
        @for (f of faq() ?? []; track f.id) {
          <div class="item" [class.open]="open() === f.id">
            <button class="q" (click)="open.set(open() === f.id ? null : f.id)" [attr.aria-expanded]="open() === f.id">
              <span>{{ f.question }}</span>
              <app-icon [name]="open() === f.id ? 'minus' : 'plus'" [size]="18" />
            </button>
            <div class="a"><div class="a-inner"><p>{{ f.answer }}</p></div></div>
          </div>
        } @empty {
          <div class="skeleton" style="height:240px"></div>
        }
      </div>
    </section>
  `,
  styles: `${INFO_STYLES}
    .list { border-top: 1px solid var(--line); }
    .item { border-bottom: 1px solid var(--line); }
    .q { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 0; border: 0; background: none; text-align: left; font-family: var(--font-serif); font-size: clamp(19px, 2vw, 22px); }
    .a { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .4s var(--ease); }
    .a-inner { overflow: hidden; }
    .a p { margin: 0 0 22px; color: var(--ink-2); line-height: 1.75; white-space: pre-line; }
    .open .a { grid-template-rows: 1fr; }
  `,
})
export class FaqPage {
  protected faq = toSignal(inject(Store).faq());
  protected open = signal<number | null>(null);
}
