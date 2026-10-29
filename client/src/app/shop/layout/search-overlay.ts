import { ChangeDetectionStrategy, Component, ElementRef, HostListener, effect, inject, model, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { ProductCard } from '../../core/models';
import { Store } from '../../core/store.service';
import { Icon } from '../../shared/icon';
import { UahPipe } from '../../shared/uah.pipe';

const POPULAR = ['Сукня', 'Пальто', 'Жакет', 'Светр', 'Льон', 'Спідниця'];

@Component({
  selector: 'app-search-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, UahPipe],
  template: `
    @if (open()) {
      <div class="overlay" (click)="close()">
        <div class="panel" (click)="$event.stopPropagation()">
          <div class="container">
            <form class="field-row" (submit)="submit($event)">
              <app-icon name="search" [size]="22" />
              <input #input class="q" [value]="query()" (input)="onInput($any($event.target).value)" placeholder="Що ви шукаєте?" aria-label="Пошук" autocomplete="off" />
              <button type="button" class="icon-btn" (click)="close()" aria-label="Закрити"><app-icon name="close" /></button>
            </form>
            @if (!query()) {
              <div class="popular">
                <span class="eyebrow">Популярні запити</span>
                <div class="chips">
                  @for (p of popular; track p) { <button class="chip" (click)="onInput(p)">{{ p }}</button> }
                </div>
              </div>
            } @else {
              <div class="results">
                @if (loading()) {
                  <div class="muted small">Шукаємо…</div>
                } @else if (results().length) {
                  <div class="grid">
                    @for (p of results(); track p.id) {
                      <a [routerLink]="['/product', p.slug]" (click)="close()" class="res">
                        <div class="img">@if (p.images[0]) { <img [src]="p.images[0]" [alt]="p.name" /> }</div>
                        <div class="small">{{ p.name }}</div>
                        <div class="small muted">{{ p.price | uah }}</div>
                      </a>
                    }
                  </div>
                  <button class="btn btn-outline btn-sm" (click)="submit()">Усі результати ({{ total() }})</button>
                } @else {
                  <div class="muted">Нічого не знайдено за запитом «{{ query() }}»</div>
                }
              </div>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .overlay { position: fixed; inset: 0; z-index: 400; background: rgba(31,29,26,.35); animation: fade .25s; }
    @keyframes fade { from { opacity: 0; } }
    .panel { background: var(--bg); padding: 20px 0 32px; animation: down .35s var(--ease); max-height: 90vh; overflow-y: auto; }
    @keyframes down { from { transform: translateY(-20px); opacity: 0; } }
    .field-row { display: flex; align-items: center; gap: 14px; border-bottom: 1px solid var(--ink); padding-bottom: 10px; }
    .q { flex: 1; border: 0; background: transparent; outline: none; font-family: var(--font-serif); font-size: clamp(24px, 4vw, 38px); min-width: 0; }
    .popular { margin-top: 24px; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .results { margin-top: 24px; display: flex; flex-direction: column; gap: 20px; align-items: flex-start; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; width: 100%; }
    @media (min-width: 900px) { .grid { grid-template-columns: repeat(6, 1fr); } }
    .res { display: flex; flex-direction: column; gap: 4px; }
    .img { aspect-ratio: 3/4; background: var(--surface-2); overflow: hidden; margin-bottom: 4px; }
    .img img { width: 100%; height: 100%; object-fit: cover; transition: transform .6s var(--ease); }
    .res:hover img { transform: scale(1.04); }
  `,
})
export class SearchOverlay {
  readonly open = model(false);
  private store = inject(Store);
  private router = inject(Router);
  private input = viewChild<ElementRef<HTMLInputElement>>('input');
  protected popular = POPULAR;
  protected query = signal('');
  protected results = signal<ProductCard[]>([]);
  protected total = signal(0);
  protected loading = signal(false);
  private q$ = new Subject<string>();

  constructor() {
    effect(() => {
      if (this.open()) setTimeout(() => this.input()?.nativeElement.focus(), 30);
    });
    this.q$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((q) => (q.trim().length < 2 ? of(null) : this.store.products({ q, limit: 6, sort: 'popular' }))),
        takeUntilDestroyed(),
      )
      .subscribe((res) => {
        this.loading.set(false);
        this.results.set(res?.items ?? []);
        this.total.set(res?.total ?? 0);
      });
  }

  onInput(v: string) {
    this.query.set(v);
    this.loading.set(v.trim().length >= 2);
    this.q$.next(v);
  }

  submit(e?: Event) {
    e?.preventDefault();
    const q = this.query().trim();
    if (!q) return;
    this.close();
    this.router.navigate(['/catalog'], { queryParams: { q } });
  }

  close() {
    this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEsc() {
    this.close();
  }
}
