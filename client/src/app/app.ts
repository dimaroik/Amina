import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Analytics } from './core/analytics.service';
import { ToastsHost } from './shared/toasts';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, ToastsHost],
  template: `<router-outlet /><app-toasts />`,
})
export class App {
  constructor() {
    inject(Analytics);
  }
}
