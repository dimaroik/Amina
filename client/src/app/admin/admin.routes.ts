import { Routes } from '@angular/router';
import { adminGuard } from '../core/auth.service';

export const ADMIN_ROUTES: Routes = [
  { path: 'login', title: 'Вхід — Amina Admin', loadComponent: () => import('./pages/login/admin-login').then((m) => m.AdminLoginPage) },
  {
    path: '',
    canActivate: [adminGuard],
    loadComponent: () => import('./layout/admin-layout').then((m) => m.AdminLayout),
    children: [],
  },
];
