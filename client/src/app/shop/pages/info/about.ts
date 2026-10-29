import { ChangeDetectionStrategy, Component } from '@angular/core';

// TODO: implement
@Component({
  selector: 'app-about',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="container section"><h1 class="h1">AboutPage</h1></div>`,
})
export class AboutPage {}
