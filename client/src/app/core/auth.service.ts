import { HttpInterceptorFn } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { Api } from './api.service';
import type { User } from './models';
import { storage } from './storage';

interface Session {
  token: string;
  user: User;
}

@Injectable({ providedIn: 'root' })
export class Auth {
  private api = inject(Api);
  private router = inject(Router);
  private session = signal<Session | null>(storage.get<Session | null>('amina.session', null));

  readonly user = computed(() => this.session()?.user ?? null);
  readonly token = computed(() => this.session()?.token ?? null);
  readonly isLoggedIn = computed(() => !!this.session());
  readonly isAdmin = computed(() => this.session()?.user.role === 'admin');

  private save(s: Session | null) {
    this.session.set(s);
    if (s) storage.set('amina.session', s);
    else storage.remove('amina.session');
  }

  login(email: string, password: string): Observable<Session> {
    return this.api.post<Session>('/auth/login', { email, password }).pipe(tap((s) => this.save(s)));
  }

  register(data: { name: string; email: string; phone: string; password: string }): Observable<Session> {
    return this.api.post<Session>('/auth/register', data).pipe(tap((s) => this.save(s)));
  }

  updateUser(user: User) {
    const s = this.session();
    if (s) this.save({ ...s, user });
  }

  logout(redirect = '/') {
    this.save(null);
    this.router.navigateByUrl(redirect);
  }

  /** Called on 401: drop the session and send admins back to their login page. */
  expire() {
    const wasAdminArea = location.pathname.startsWith('/admin');
    this.save(null);
    if (wasAdminArea) this.router.navigate(['/admin/login'], { queryParams: { next: location.pathname } });
  }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(Auth);
  const token = auth.token();
  const authed = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(authed).pipe(
    tap({
      error: (err) => {
        if (err?.status === 401 && token) auth.expire();
      },
    }),
  );
};

export const adminGuard: CanActivateFn = (_route, state) => {
  const auth = inject(Auth);
  if (auth.isAdmin()) return true;
  return inject(Router).createUrlTree(['/admin/login'], { queryParams: { next: state.url } });
};

export const userGuard: CanActivateFn = (_route, state) => {
  const auth = inject(Auth);
  if (auth.isLoggedIn()) return true;
  return inject(Router).createUrlTree(['/login'], { queryParams: { next: state.url } });
};
