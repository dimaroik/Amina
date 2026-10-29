import { ChangeDetectionStrategy, Component } from '@angular/core';

// TODO: implement
@Component({
  selector: 'app-admin-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="container section"><h1 class="h1">AdminLayout</h1></div>`,
})
export class AdminLayout {}
