import { Routes } from '@angular/router';
import { userGuard } from '../core/auth.service';
import { ShopLayout } from './layout/shop-layout';

export const SHOP_ROUTES: Routes = [
  {
    path: '',
    component: ShopLayout,
    children: [
      { path: '', title: 'Amina — сучасний жіночий одяг', loadComponent: () => import('./pages/home/home').then((m) => m.HomePage) },
      { path: 'catalog', title: 'Каталог — Amina', loadComponent: () => import('./pages/catalog/catalog').then((m) => m.CatalogPage) },
      { path: 'catalog/:slug', loadComponent: () => import('./pages/catalog/catalog').then((m) => m.CatalogPage) },
      { path: 'product/:slug', loadComponent: () => import('./pages/product/product').then((m) => m.ProductPage) },
      { path: 'cart', title: 'Кошик — Amina', loadComponent: () => import('./pages/cart/cart-page').then((m) => m.CartPage) },
      { path: 'checkout', title: 'Оформлення замовлення — Amina', loadComponent: () => import('./pages/checkout/checkout').then((m) => m.CheckoutPage) },
      { path: 'order/:number', title: 'Замовлення — Amina', loadComponent: () => import('./pages/order/order-page').then((m) => m.OrderPage) },
      { path: 'track', title: 'Відстежити замовлення — Amina', loadComponent: () => import('./pages/track/track').then((m) => m.TrackPage) },
      { path: 'wishlist', title: 'Обране — Amina', loadComponent: () => import('./pages/wishlist/wishlist-page').then((m) => m.WishlistPage) },
      { path: 'login', title: 'Вхід — Amina', loadComponent: () => import('./pages/account/login').then((m) => m.LoginPage) },
      { path: 'register', title: 'Реєстрація — Amina', loadComponent: () => import('./pages/account/register').then((m) => m.RegisterPage) },
      { path: 'account', title: 'Мій кабінет — Amina', canActivate: [userGuard], loadComponent: () => import('./pages/account/account').then((m) => m.AccountPage) },
      { path: 'faq', title: 'Питання та відповіді — Amina', loadComponent: () => import('./pages/info/faq').then((m) => m.FaqPage) },
      { path: 'about', title: 'Про нас — Amina', loadComponent: () => import('./pages/info/about').then((m) => m.AboutPage) },
      { path: 'contacts', title: 'Контакти — Amina', loadComponent: () => import('./pages/info/contacts').then((m) => m.ContactsPage) },
      { path: 'delivery', title: 'Доставка й оплата — Amina', loadComponent: () => import('./pages/info/delivery-info').then((m) => m.DeliveryInfoPage) },
      { path: '**', title: 'Сторінку не знайдено — Amina', loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFoundPage) },
    ],
  },
];
