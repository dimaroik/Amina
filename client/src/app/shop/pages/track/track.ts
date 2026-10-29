import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

@Component({
  selector: 'app-track',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <section class="track container">
      <form class="box" (ngSubmit)="submit()">
        <span class="eyebrow">Де моє замовлення?</span>
        <h1 class="h1">Відстежити замовлення</h1>
        <p class="muted">Вкажіть номер замовлення з листа або SMS і телефон, який ви залишали при оформленні.</p>
        <div class="field"><label class="label" for="t-num">Номер замовлення</label><input id="t-num" class="input" name="number" [(ngModel)]="number" placeholder="AM-1001" required /></div>
        <div class="field"><label class="label" for="t-phone">Телефон</label><input id="t-phone" class="input" type="tel" name="phone" [(ngModel)]="phone" placeholder="+380" required /></div>
        <button class="btn btn-block" [disabled]="!number.trim() || !phone.trim()">Знайти замовлення</button>
      </form>
    </section>
  `,
  styles: `
    .track { min-height: 65vh; display: grid; place-items: center; padding-top: 56px; padding-bottom: 80px; }
    .box { width: 100%; max-width: 440px; display: flex; flex-direction: column; gap: 16px; text-align: center; }
    .box .field { text-align: left; }
    .box p { margin: 0 0 8px; }
  `,
})
export class TrackPage {
  private router = inject(Router);
  protected number = '';
  protected phone = '';

  submit() {
    let n = this.number.trim().toUpperCase().replace(/\s/g, '');
    if (/^\d+$/.test(n)) n = `AM-${n}`;
    n = n.replace(/^AM(\d)/, 'AM-$1');
    this.router.navigate(['/order', n], { queryParams: { phone: this.phone.trim() } });
  }
}
