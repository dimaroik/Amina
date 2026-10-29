import { inject } from '@angular/core';
import { CanDeactivateFn, Routes } from '@angular/router';
import { adminGuard } from '../core/auth.service';
import { Confirm } from './ui/confirm';

export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

export const unsavedGuard: CanDeactivateFn<HasUnsavedChanges> = (cmp) =>
  !cmp.hasUnsavedChanges() ||
  inject(Confirm).ask('Є незбережені зміни. Покинути сторінку без збереження?', { confirmLabel: 'Покинути', danger: true });

export const ADMIN_ROUTES: Routes = [
  { path: 'login', title: 'Вхід — Amina Admin', loadComponent: () => import('./pages/login/admin-login').then((m) => m.AdminLoginPage) },
  {
    path: '',
    canActivate: [adminGuard],
    loadComponent: () => import('./layout/admin-layout').then((m) => m.AdminLayout),
    children: [
      { path: '', title: 'Огляд — Amina Admin', loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.DashboardPage) },
      { path: 'orders', title: 'Замовлення — Amina Admin', loadComponent: () => import('./pages/orders/orders-list').then((m) => m.OrdersListPage) },
      { path: 'orders/:id', title: 'Замовлення — Amina Admin', loadComponent: () => import('./pages/orders/order-detail').then((m) => m.OrderDetailPage) },
      { path: 'products', title: 'Товари — Amina Admin', loadComponent: () => import('./pages/products/products-list').then((m) => m.ProductsListPage) },
      { path: 'products/new', title: 'Новий товар — Amina Admin', canDeactivate: [unsavedGuard], loadComponent: () => import('./pages/products/product-editor').then((m) => m.ProductEditorPage) },
      { path: 'products/:id', title: 'Товар — Amina Admin', canDeactivate: [unsavedGuard], loadComponent: () => import('./pages/products/product-editor').then((m) => m.ProductEditorPage) },
      { path: 'categories', title: 'Категорії — Amina Admin', loadComponent: () => import('./pages/categories/categories').then((m) => m.CategoriesPage) },
      { path: 'customers', title: 'Клієнти — Amina Admin', loadComponent: () => import('./pages/customers/customers').then((m) => m.CustomersPage) },
      { path: 'chats', title: 'Звернення — Amina Admin', loadComponent: () => import('./pages/chats/chats').then((m) => m.ChatsPage) },
      { path: 'chats/:id', title: 'Звернення — Amina Admin', loadComponent: () => import('./pages/chats/chats').then((m) => m.ChatsPage) },
      { path: 'promo', title: 'Промокоди — Amina Admin', loadComponent: () => import('./pages/promo/promo').then((m) => m.PromoPage) },
      { path: 'content', title: 'Контент — Amina Admin', loadComponent: () => import('./pages/content/content').then((m) => m.ContentPage) },
      { path: 'delivery-payment', title: 'Доставка й оплата — Amina Admin', loadComponent: () => import('./pages/delivery-payment/delivery-payment').then((m) => m.DeliveryPaymentPage) },
      { path: 'settings', title: 'Налаштування — Amina Admin', loadComponent: () => import('./pages/settings/settings').then((m) => m.SettingsPage) },
      { path: 'admins', title: 'Адміністратори — Amina Admin', loadComponent: () => import('./pages/admins/admins').then((m) => m.AdminsPage) },
      { path: '**', redirectTo: '' },
    ],
  },
];
