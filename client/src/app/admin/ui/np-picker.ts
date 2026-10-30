import { ChangeDetectionStrategy, Component, inject, input, model, signal } from '@angular/core';
import { Subject, catchError, debounceTime, of, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Api } from '../../core/api.service';

interface Option { ref: string; name: string; area?: string }

/** Autocomplete for a Nova Poshta city or a warehouse in a given city. */
@Component({
  selector: 'adm-np-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="np">
      <input class="input" [value]="name()" (input)="onInput($any($event.target).value)" (focus)="onFocus()" (blur)="close()"
        [placeholder]="kind() === 'city' ? 'Почніть вводити місто' : (cityRef() ? 'Номер або адреса відділення' : 'Спершу оберіть місто')"
        [disabled]="kind() === 'warehouse' && !cityRef()" autocomplete="off" />
      @if (ref()) { <span class="ok" title="Обрано з довідника Нової пошти">✓</span> }
      @if (open() && options().length) {
        <ul class="list">
          @for (o of options(); track o.ref) {
            <li (mousedown)="pick(o)">{{ o.name }}@if (o.area) { <span class="adm-muted tiny"> · {{ o.area }} обл.</span> }</li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .np { position: relative; }
    .ok { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: var(--success); font-weight: 700; }
    .list { position: absolute; z-index: 20; top: 100%; left: 0; right: 0; max-height: 240px; overflow: auto; margin: 4px 0 0; padding: 4px 0; list-style: none; background: var(--surface); border: 1px solid var(--line-strong); border-radius: 6px; box-shadow: var(--shadow); }
    li { padding: 8px 12px; font-size: 13px; cursor: pointer; }
    li:hover { background: var(--surface-2); }
  `,
})
export class NpPicker {
  private api = inject(Api);
  readonly kind = input<'city' | 'warehouse'>('city');
  readonly cityRef = input('');
  readonly name = model('');
  readonly ref = model('');
  protected options = signal<Option[]>([]);
  protected open = signal(false);
  private q$ = new Subject<string>();

  constructor() {
    this.q$
      .pipe(
        debounceTime(250),
        switchMap((q) => {
          if (this.kind() === 'city') return q.length < 2 ? of([]) : this.api.get<Option[]>('/np/cities', { q }).pipe(catchError(() => of([])));
          return this.cityRef() ? this.api.get<Option[]>('/np/warehouses', { cityRef: this.cityRef(), q }).pipe(catchError(() => of([]))) : of([]);
        }),
        takeUntilDestroyed(),
      )
      .subscribe((r) => this.options.set(r));
  }

  onInput(v: string) {
    this.name.set(v);
    this.ref.set('');
    this.open.set(true);
    this.q$.next(v.trim());
  }

  onFocus() {
    this.open.set(true);
    if (this.kind() === 'warehouse') this.q$.next(this.ref() ? '' : this.name());
  }

  close() {
    setTimeout(() => this.open.set(false), 150);
  }

  pick(o: Option) {
    this.name.set(o.name);
    this.ref.set(o.ref);
    this.open.set(false);
  }
}
