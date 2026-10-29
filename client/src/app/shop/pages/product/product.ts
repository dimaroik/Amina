import { ChangeDetectionStrategy, Component } from '@angular/core';

// TODO: implement
@Component({
  selector: 'app-product',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="container section"><h1 class="h1">ProductPage</h1></div>`,
})
export class ProductPage {}
