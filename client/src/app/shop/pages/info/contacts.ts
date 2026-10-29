import { ChangeDetectionStrategy, Component } from '@angular/core';

// TODO: implement
@Component({
  selector: 'app-contacts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="container section"><h1 class="h1">ContactsPage</h1></div>`,
})
export class ContactsPage {}
