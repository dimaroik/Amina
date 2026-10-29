import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../../core/api.service';
import { Auth } from '../../../core/auth.service';
import { AUTH_STYLES } from './auth-styles';

@Component({
  selector: 'app-register',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="auth">
      <form class="box" (ngSubmit)="submit()">
        <div class="head">
          <span class="eyebrow">Ласкаво просимо</span>
          <h1 class="h1">Реєстрація</h1>
          <p>Історія замовлень і швидке оформлення в один клік</p>
        </div>
        <div class="field"><label class="label" for="r-name">Ім'я та прізвище</label><input id="r-name" class="input" name="name" [(ngModel)]="form.name" autocomplete="name" required /></div>
        <div class="field"><label class="label" for="r-email">Email</label><input id="r-email" class="input" type="email" name="email" [(ngModel)]="form.email" autocomplete="email" required /></div>
        <div class="field"><label class="label" for="r-phone">Телефон</label><input id="r-phone" class="input" type="tel" name="phone" [(ngModel)]="form.phone" autocomplete="tel" placeholder="+380" /></div>
        <div class="field"><label class="label" for="r-pass">Пароль</label><input id="r-pass" class="input" type="password" name="password" [(ngModel)]="form.password" autocomplete="new-password" minlength="6" required /><span class="hint">Щонайменше 6 символів</span></div>
        @if (error()) { <div class="error">{{ error() }}</div> }
        <button class="btn btn-block" [disabled]="busy()">{{ busy() ? 'Створюємо…' : 'Створити акаунт' }}</button>
        <div class="switch">Вже є акаунт? <a class="link-underlined" routerLink="/login" [queryParams]="{ next: next() }">Увійти</a></div>
      </form>
    </section>
  `,
  styles: AUTH_STYLES,
})
export class RegisterPage {
  private auth = inject(Auth);
  private router = inject(Router);
  readonly next = input<string>();
  protected form = { name: '', email: '', phone: '', password: '' };
  protected busy = signal(false);
  protected error = signal('');

  submit() {
    this.busy.set(true);
    this.error.set('');
    this.auth.register({ ...this.form, email: this.form.email.trim() }).subscribe({
      next: () => this.router.navigateByUrl(this.next() || '/account'),
      error: (e) => {
        this.busy.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }
}
