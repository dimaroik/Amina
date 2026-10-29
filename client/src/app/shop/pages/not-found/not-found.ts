import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="nf container">
      <div class="display">404</div>
      <h1 class="h2">Такої сторінки немає</h1>
      <p class="muted">Можливо, товар уже розпродано або посилання змінилося.</p>
      <div class="row">
        <a class="btn" routerLink="/catalog">До каталогу</a>
        <a class="btn btn-outline" routerLink="/">На головну</a>
      </div>
    </section>
  `,
  styles: `
    .nf { min-height: 62vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 14px; padding-top: 48px; padding-bottom: 64px; }
    .display { color: var(--accent-soft); font-size: clamp(96px, 18vw, 200px); }
    .row { flex-wrap: wrap; justify-content: center; margin-top: 8px; }
  `,
})
export class NotFoundPage {}
