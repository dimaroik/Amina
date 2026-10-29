import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void };
}

@Injectable({ providedIn: 'root' })
export class Toasts {
  readonly items = signal<Toast[]>([]);
  private seq = 0;

  show(text: string, kind: Toast['kind'] = 'info', action?: Toast['action'], ms = 3800) {
    const id = ++this.seq;
    this.items.update((list) => [...list.slice(-3), { id, text, kind, action }]);
    setTimeout(() => this.dismiss(id), ms);
  }
  success(text: string, action?: Toast['action']) {
    this.show(text, 'success', action);
  }
  error(text: string) {
    this.show(text, 'error', undefined, 5000);
  }
  dismiss(id: number) {
    this.items.update((list) => list.filter((t) => t.id !== id));
  }
}
