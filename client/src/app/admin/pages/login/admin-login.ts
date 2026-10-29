import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../../core/api.service';
import { Auth } from '../../../core/auth.service';

@Component({
  selector: 'app-admin-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="wrap">
      <form class="box" (ngSubmit)="submit()">
        <a routerLink="/" class="logo">AMINA</a>
        <p class="eyebrow">Панель керування</p>
        <label class="field">
          <span class="label">Email</span>
          <input class="input" type="email" name="email" [(ngModel)]="email" autocomplete="username" required autofocus />
        </label>
        <label class="field">
          <span class="label">Пароль</span>
          <input class="input" type="password" name="password" [(ngModel)]="password" autocomplete="current-password" required />
        </label>
        @if (error()) { <p class="field-error">{{ error() }}</p> }
        <button class="btn btn-block" [disabled]="busy()">
          @if (busy()) { <span class="spinner"></span> } @else { Увійти }
        </button>
      </form>
    </div>
  `,
  styles: `
    .wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: radial-gradient(ellipse at top, #efe9e1, var(--bg) 60%); }
    .box { width: 100%; max-width: 380px; background: var(--surface); border: 1px solid var(--line); padding: 36px 28px; display: flex; flex-direction: column; gap: 16px; box-shadow: var(--shadow); border-radius: 10px; }
    .logo { font-family: var(--font-serif); font-size: 34px; letter-spacing: .32em; text-align: center; }
    .eyebrow { text-align: center; margin: -8px 0 8px; }
  `,
})
export class AdminLoginPage {
  private auth = inject(Auth);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  protected email = '';
  protected password = '';
  protected busy = signal(false);
  protected error = signal('');

  constructor() {
    if (this.auth.isAdmin()) this.router.navigateByUrl('/admin');
  }

  submit() {
    this.error.set('');
    this.busy.set(true);
    this.auth.login(this.email, this.password).subscribe({
      next: (s) => {
        this.busy.set(false);
        if (s.user.role !== 'admin') {
          this.auth.logout('/admin/login');
          this.error.set('Цей обліковий запис не має доступу до адмінки');
          return;
        }
        const next = this.route.snapshot.queryParamMap.get('next');
        this.router.navigateByUrl(next && next.startsWith('/admin') ? next : '/admin');
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(errorMessage(err, 'Не вдалося увійти'));
      },
    });
  }
}
