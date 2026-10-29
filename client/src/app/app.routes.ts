import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: 'admin', loadChildren: () => import('./admin/admin.routes').then((m) => m.ADMIN_ROUTES) },
  { path: '', loadChildren: () => import('./shop/shop.routes').then((m) => m.SHOP_ROUTES) },
];
