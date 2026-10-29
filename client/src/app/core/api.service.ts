import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

type Params = Record<string, string | number | boolean | null | undefined>;

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  private base = '/api';

  private params(p?: Params): HttpParams {
    let hp = new HttpParams();
    for (const [k, v] of Object.entries(p ?? {})) {
      if (v !== undefined && v !== null && v !== '') hp = hp.set(k, String(v));
    }
    return hp;
  }

  get<T>(path: string, params?: Params): Observable<T> {
    return this.http.get<T>(this.base + path, { params: this.params(params) });
  }
  post<T>(path: string, body?: unknown): Observable<T> {
    return this.http.post<T>(this.base + path, body ?? {});
  }
  put<T>(path: string, body?: unknown): Observable<T> {
    return this.http.put<T>(this.base + path, body ?? {});
  }
  patch<T>(path: string, body?: unknown): Observable<T> {
    return this.http.patch<T>(this.base + path, body ?? {});
  }
  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(this.base + path);
  }
  upload<T>(path: string, files: File[], field = 'files'): Observable<T> {
    const fd = new FormData();
    files.forEach((f) => fd.append(field, f));
    return this.http.post<T>(this.base + path, fd);
  }
  /** Absolute URL for links that bypass HttpClient (e.g. CSV export). */
  url(path: string, params?: Params): string {
    const qs = this.params(params).toString();
    return `${this.base}${path}${qs ? `?${qs}` : ''}`;
  }
}

/** Extracts a human-readable message from an API error. */
export function errorMessage(err: unknown, fallback = 'Щось пішло не так. Спробуйте ще раз.'): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'Немає з’єднання з сервером';
    const body = err.error as { error?: string; details?: { message?: string; path?: (string | number)[] }[] } | null;
    if (body?.details && Array.isArray(body.details) && body.details[0]?.message) {
      return `${body.error ?? fallback}: ${body.details[0].message}`;
    }
    return body?.error ?? fallback;
  }
  return fallback;
}
