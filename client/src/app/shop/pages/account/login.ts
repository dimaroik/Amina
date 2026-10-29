import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../../core/api.service';
import { Auth } from '../../../core/auth.service';
import { AUTH_STYLES } from './auth-styles';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="auth">
      <form class="box" (ngSubmit)="submit()">
        <div class="head">
          <span class="eyebrow">Особистий кабінет</span>
          <h1 class="h1">Вхід</h1>
          <p>Ваші замовлення та дані для швидкого оформлення</p>
        </div>
        <div class="field"><label class="label" for="l-email">Email</label><input id="l-email" class="input" type="email" name="email" [(ngModel)]="email" autocomplete="email" required /></div>
        <div class="field"><label class="label" for="l-pass">Пароль</label><input id="l-pass" class="input" type="password" name="password" [(ngModel)]="password" autocomplete="current-password" required /></div>
        @if (error()) { <div class="error">{{ error() }}</div> }
        <button class="btn btn-block" [disabled]="busy()">{{ busy() ? 'Входимо…' : 'Увійти' }}</button>
        <div class="switch">Немає акаунта? <a class="link-underlined" routerLink="/register" [queryParams]="{ next: next() }">Зареєструватися</a></div>
        <div class="switch">Оформили замовлення без реєстрації? <a class="link-underlined" routerLink="/track">Відстежити</a></div>
      </form>
    </section>
  `,
  styles: AUTH_STYLES,
})
export class LoginPage {
  private auth = inject(Auth);
  private router = inject(Router);
  readonly next = input<string>();
  protected email = '';
  protected password = '';
  protected busy = signal(false);
  protected error = signal('');

  submit() {
    this.busy.set(true);
    this.error.set('');
    this.auth.login(this.email.trim(), this.password).subscribe({
      next: (s) => this.router.navigateByUrl(this.next() || (s.user.role === 'admin' ? '/admin' : '/account')),
      error: (e) => {
        this.busy.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }
}
