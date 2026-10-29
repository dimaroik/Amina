import { ChangeDetectionStrategy, Component } from '@angular/core';

// TODO: implement
@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="container section"><h1 class="h1">HomePage</h1></div>`,
})
export class HomePage {}
