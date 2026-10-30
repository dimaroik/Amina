import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import QRCode from 'qrcode';
import { errorMessage } from '../../../core/api.service';
import { Toasts } from '../../../core/toast.service';
import { Icon } from '../../../shared/icon';
import { AdminApi, type AdminSettings } from '../../admin-api';
import { NpPicker } from '../../ui/np-picker';

interface SocialStatus {
  instagram: { configured: boolean; connected: { username: string; expiresAt: string; via: 'instagram' | 'facebook' } | null; redirectUri: string };
  facebook: { configured: boolean; businessLogin: boolean; connected: { pageName: string; pageId: string } | null; pending: { id: string; name: string }[]; redirectUri: string };
  https: boolean;
}

interface ChannelQueue {
  pending: { id: number; product_id: number; name: string; kind: string; run_at: string; source: string; attempts: number; error: string | null; target: string }[];
  digest: { products: { id: number; name: string }[]; last: { date: string; count: number } | null };
}

type Tab = 'store' | 'payment' | 'np' | 'notifications' | 'telegram' | 'social' | 'autopost' | 'chatbot' | 'analytics' | 'integrations';
type S = AdminSettings['settings'];

const STORE_FIELDS: { key: string; label: string; hint?: string; wide?: boolean; area?: boolean }[] = [
  { key: 'name', label: 'Назва магазину' },
  { key: 'tagline', label: 'Слоган' },
  { key: 'announcement', label: 'Рядок оголошення вгорі сайту', hint: 'Порожньо — смуга не показується', wide: true },
  { key: 'phone', label: 'Телефон' },
  { key: 'email', label: 'Email' },
  { key: 'workHours', label: 'Графік роботи' },
  { key: 'address', label: 'Адреса / шоурум' },
  { key: 'instagram', label: 'Instagram (посилання)' },
  { key: 'telegram', label: 'Telegram (посилання)' },
  { key: 'viber', label: 'Viber (посилання)' },
  { key: 'whatsapp', label: 'WhatsApp (посилання)' },
  { key: 'facebook', label: 'Facebook (посилання)' },
  { key: 'tiktok', label: 'TikTok (посилання)' },
  { key: 'about', label: 'Про бренд (сторінка «Про нас» і головна)', wide: true, area: true },
];

@Component({
  selector: 'app-admin-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, DatePipe, Icon, NpPicker],
  template: `
    <div class="adm-page">
      <div class="adm-page-head"><div><h1>Налаштування</h1><div class="sub">Інформація про магазин, оплата, сповіщення й чат-бот</div></div></div>
      <div class="adm-tabs">
        @for (t of tabs; track t.v) { <button [class.active]="tab() === t.v" (click)="tab.set(t.v)">{{ t.l }}</button> }
      </div>

      @if (s(); as s) {
        @switch (tab()) {
          @case ('store') {
            <div class="adm-card pad"><div class="form-grid">
              @for (f of storeFields; track f.key) {
                <div class="field" [class.full]="f.wide">
                  <label class="label">{{ f.label }}</label>
                  @if (f.area) { <textarea class="textarea" rows="4" [(ngModel)]="s.store[f.key]"></textarea> }
                  @else { <input class="input" [(ngModel)]="s.store[f.key]" /> }
                  @if (f.hint) { <div class="adm-hint">{{ f.hint }}</div> }
                </div>
              }
            </div></div>
          }
          @case ('payment') {
            <div class="adm-split">
              <div class="adm-card pad adm-stack" style="gap:14px">
                <div class="adm-section-title">Monobank банка (QR-код)</div>
                <div class="field">
                  <label class="label">Посилання на банку</label>
                  <input class="input" [(ngModel)]="s.payment.monoJarUrl" placeholder="https://send.monobank.ua/jar/XXXXXXX" />
                  <div class="adm-hint">У застосунку monobank: Банка → Поділитися → Скопіювати посилання. Клієнт отримає QR із сумою замовлення.</div>
                </div>
                <div class="adm-sep"></div>
                <div class="adm-section-title">Реквізити для переказу (IBAN)</div>
                <div class="form-grid">
                  <div class="field full"><label class="label">IBAN</label><input class="input" [(ngModel)]="s.payment.iban" placeholder="UA00 0000 0000 0000 0000 0000 000" /></div>
                  <div class="field"><label class="label">Отримувач</label><input class="input" [(ngModel)]="s.payment.recipient" placeholder="ФОП Прізвище Ім'я" /></div>
                  <div class="field"><label class="label">ЄДРПОУ / ІПН</label><input class="input" [(ngModel)]="s.payment.edrpou" /></div>
                  <div class="field"><label class="label">Банк</label><input class="input" [(ngModel)]="s.payment.bankName" /></div>
                  <div class="field"><label class="label">Призначення платежу</label><input class="input" [(ngModel)]="s.payment.paymentPurpose" /><div class="adm-hint">{{ '{number}' }} заміниться номером замовлення</div></div>
                </div>
                <div class="adm-sep"></div>
                <div class="adm-section-title">Накладений платіж</div>
                <div class="field" style="max-width:420px">
                  <label class="label">Вимикати для номера після стількох невикупів</label>
                  <input class="input" type="number" min="0" max="10" [(ngModel)]="s.payment.codBlockAfterRefusals" />
                  <div class="adm-hint">Якщо клієнтка стільки разів не забрала посилку, на сайті їй буде доступна лише передоплата. 0 — не вимикати. Окремі номери можна позначити вручну на сторінці «Накладений платіж».</div>
                </div>
              </div>
              <div class="adm-card pad qr-card">
                <div class="adm-section-title">Так побачить клієнт</div>
                @if (qr()) {
                  <img [src]="qr()" alt="QR" class="qr" />
                  <div class="small">Сума: 1 250 ₴ · «Оплата замовлення AM-1001»</div>
                  <a class="btn btn-ghost btn-xs" [href]="sampleLink()" target="_blank">Перевірити посилання</a>
                } @else {
                  <div class="adm-empty">Вставте посилання на банку, щоб побачити QR</div>
                }
              </div>
            </div>
          }
          @case ('np') {
            <div class="adm-grid adm-grid-2">
              <div class="adm-card pad adm-stack" style="gap:12px">
                <div class="adm-section-title">Звідки відправляєте</div>
                @if (!i()?.novaPoshta) {
                  <p class="adm-hint" style="margin:0;color:var(--warning)">Додайте NOVA_POSHTA_API_KEY на Render, щоб працювали пошук і створення ТТН.</p>
                }
                <div class="field"><label class="label">Місто відправки</label>
                  <adm-np-picker kind="city" [(name)]="s.novaPoshta.senderCityName" [(ref)]="s.novaPoshta.senderCityRef" (refChange)="s.novaPoshta.senderWarehouseRef = ''; s.novaPoshta.senderWarehouseName = ''" /></div>
                <div class="field"><label class="label">Відділення відправки</label>
                  <adm-np-picker kind="warehouse" [cityRef]="s.novaPoshta.senderCityRef" [(name)]="s.novaPoshta.senderWarehouseName" [(ref)]="s.novaPoshta.senderWarehouseRef" /></div>
                <div class="field"><label class="label">Телефон відправника</label><input class="input" [(ngModel)]="s.novaPoshta.senderPhone" placeholder="+380…" />
                  <div class="adm-hint">Той самий номер, що в кабінеті Нової пошти.</div></div>
                <div><button class="btn btn-ghost btn-xs" (click)="checkNp()"><app-icon name="check" [size]="13" /> Перевірити підключення до кабінету НП</button></div>
              </div>
              <div class="adm-card pad adm-stack" style="gap:12px">
                <div class="adm-section-title">Значення за замовчуванням для ТТН</div>
                <div class="form-grid">
                  <div class="field"><label class="label">Вага посилки, кг</label><input class="input" type="number" min="0.1" step="0.1" [(ngModel)]="s.novaPoshta.defaultWeight" /></div>
                  <div class="field"><label class="label">Опис вантажу</label><input class="input" [(ngModel)]="s.novaPoshta.defaultDescription" /></div>
                  <div class="field full"><label class="label">Доставку оплачує</label>
                    <select class="select" [(ngModel)]="s.novaPoshta.payer"><option value="Recipient">Отримувач</option><option value="Sender">Відправник (магазин)</option></select></div>
                </div>
                <label class="adm-switch"><input type="checkbox" [(ngModel)]="s.novaPoshta.autoTrack" /><span class="track"></span> Автоматично оновлювати статуси замовлень за трекінгом</label>
                <p class="adm-hint" style="margin:0">Кожні 30 хв (поки сайт активний): посилка в дорозі → «Відправлене», отримана → «Доставлене»; коли прибула у відділення — клієнт отримує повідомлення.</p>
              </div>
            </div>
          }
          @case ('telegram') {
            <div class="adm-grid adm-grid-2">
              <div class="adm-card pad adm-stack" style="gap:12px">
                <div class="adm-section-title">Канал магазину — автопостинг</div>
                @if (!i()?.telegram) { <p class="adm-hint" style="margin:0;color:var(--warning)">Спершу підключіть Telegram-бота (TELEGRAM_BOT_TOKEN на Render).</p> }
                <ol class="steps small">
                  <li>Відкрийте канал → Адміністратори → Додати адміністратора → знайдіть бота <b>{{ i()?.telegramBot ? '@' + i()!.telegramBot : 'магазину' }}</b>.</li>
                  <li>Дайте йому право «Публікація повідомлень».</li>
                  <li>Вкажіть канал нижче й натисніть «Перевірити».</li>
                </ol>
                <div class="field"><label class="label">Канал</label>
                  <div class="adm-row nowrap">
                    <input class="input" [(ngModel)]="s.channel.chatId" placeholder="@amina_store або -1001234567890" />
                    <button class="btn btn-ghost btn-xs" [disabled]="!s.channel.chatId" (click)="testChannel()">Перевірити</button>
                  </div>
                  <div class="adm-hint">Для публічного каналу — його @назва. Для приватного — числовий ID (починається з -100).</div></div>
                <div class="field"><label class="label">Текст кнопки під постом</label><input class="input" [(ngModel)]="s.channel.buttonText" maxlength="40" /></div>
                <label class="adm-switch"><input type="checkbox" [(ngModel)]="s.channel.album" /><span class="track"></span> Альбом до 4 фото, якщо в товару кілька фото</label>
                <p class="adm-hint" style="margin:0">Пост: фото товару (або альбом), назва, ціна (і знижка), опис, розміри, кольори та посилання на сторінку товару. Коли саме публікується — у вкладці <a class="link-plain" href="" (click)="$event.preventDefault(); tab.set('autopost')">«Автопублікація»</a>. Будь-який товар можна опублікувати вручну — кнопкою «Опублікувати» в редакторі товару.</p>
              </div>
              <div class="adm-card pad adm-stack" style="gap:12px">
                <div class="adm-section-title">Керування замовленнями з Telegram</div>
                <p class="small" style="margin:0">Чати, вказані у вкладці «Сповіщення» (поле «Telegram chat ID»), отримують нові замовлення з кнопками:</p>
                <ul class="steps small">
                  <li>✅ Підтвердити / ❌ Скасувати (з підтвердженням)</li>
                  <li>📦 Створити ТТН з налаштувань «Нова пошта» і 🏷 отримати наклейку PDF</li>
                  <li>💰 Гроші отримано — для накладеного платежу</li>
                  <li>🚫 Лише передоплата — якщо посилку не забрали</li>
                </ul>
                <p class="small" style="margin:0">Команди бота: <code>/orders</code> — замовлення в роботі, <code>/today</code> — продажі за сьогодні, <code>/cod</code> — накладений платіж, <code>/help</code>.</p>
                <p class="adm-hint" style="margin:0">Кнопки працюють лише в чатах зі списку, тож випадкові люди нічого змінити не можуть. Щоб дізнатися свій chat ID, напишіть боту <code>/id</code>.</p>
                @if (!s.notifications.telegramAdminChatIds.length) { <p class="adm-hint" style="margin:0;color:var(--warning)">Зараз жодного chat ID не вказано — додайте свій у вкладці «Сповіщення».</p> }
              </div>
            </div>
          }
          @case ('autopost') {
            <div class="adm-grid adm-grid-2">
              <div class="adm-card pad adm-stack" style="gap:12px">
                <div class="adm-section-title">Куди публікувати</div>
                <label class="adm-switch"><input type="checkbox" [(ngModel)]="s.channel.telegramAuto" /><span class="track"></span> Telegram-канал
                  @if (!s.channel.chatId) { <span class="adm-muted small">— канал не вказано</span> }</label>
                <label class="adm-switch"><input type="checkbox" [(ngModel)]="s.social.instagram" /><span class="track"></span> Instagram
                  @if (social() && !social()!.instagram.connected) { <span class="adm-muted small">— не підключено</span> }</label>
                <label class="adm-switch"><input type="checkbox" [(ngModel)]="s.social.facebook" /><span class="track"></span> Facebook
                  @if (social() && !social()!.facebook.connected) { <span class="adm-muted small">— не підключено</span> }</label>
                <p class="adm-hint" style="margin:0">Правила нижче однакові для всіх місць. Підключення — у вкладках «Telegram» та «Instagram і Facebook».</p>
              </div>
              <div class="adm-card pad adm-stack" style="gap:12px">
                <div class="adm-section-title">Коли публікувати</div>
                <label class="adm-switch"><input type="checkbox" [(ngModel)]="s.channel.postOnCreate" /><span class="track"></span> ✨ Новий товар, доданий вручну</label>
                <label class="adm-switch"><input type="checkbox" [(ngModel)]="s.channel.postOnRestock" /><span class="track"></span> 🔁 Залишок змінено вручну з 0 — «Знову в наявності»</label>
                <label class="adm-switch"><input type="checkbox" [(ngModel)]="s.channel.postOnReceive" /><span class="track"></span> 📦 Поставку оприбутковано — новинки й «знову в наявності»</label>
                <label class="adm-switch"><input type="checkbox" [(ngModel)]="s.channel.postOnAnnounce" /><span class="track"></span> 🚚 Поставку показано на сайті — «Уже в дорозі / Передзамовлення»</label>
                <label class="adm-switch"><input type="checkbox" [(ngModel)]="s.channel.postOnSale" /><span class="track"></span> 🏷 На товар з'явилась знижка (або стала більшою)</label>
                <div class="field">
                  <label class="label">Для товарів, доданих вручну, чекати після останнього збереження</label>
                  <select class="select" style="max-width:220px" [(ngModel)]="s.channel.manualDelay">
                    @for (d of delays; track d.v) { <option [ngValue]="d.v">{{ d.l }}</option> }
                  </select>
                  <div class="adm-hint">Щоб встигнути дозаповнити фото, опис і розміри. Кожне нове збереження відкладає пост ще на стільки ж.</div>
                </div>
                <div class="field">
                  <label class="label">Час виходу автоматичних постів</label>
                  <div class="adm-row nowrap">
                    <select class="select" style="max-width:220px" [ngModel]="s.channel.autoTime ? 'time' : 'now'" (ngModelChange)="s.channel.autoTime = $event === 'time' ? '19:00' : ''">
                      <option value="now">Одразу</option><option value="time">О певній годині</option>
                    </select>
                    @if (s.channel.autoTime) { <input class="input" type="time" style="max-width:130px" [(ngModel)]="s.channel.autoTime" /> }
                  </div>
                  <div class="adm-hint">@if (s.channel.autoTime) { Пости чекатимуть до {{ s.channel.autoTime }} за Києвом і вийдуть по черзі. } @else { Пост виходить одразу після події (для доданих вручну — після очікування вище). }</div>
                </div>
              </div>
              <div class="adm-card pad adm-stack" style="gap:12px">
                <div class="adm-section-title">Що не публікується</div>
                <ul class="steps small">
                  <li>Прихований товар, товар без фото або без залишку («Новинка», «Знову в наявності», «Знижка»). Якщо товар сховали чи він закінчився, поки пост чекав, — пост скасовується.</li>
                  <li>Той самий товар частіше ніж раз на 2 дні в одне місце. Виняток — нова або більша знижка.</li>
                  <li>«Новинкою» вважається товар, доданий за останні 14 днів, який ще ніде не публікувався. Редагування старих товарів нічого не публікує.</li>
                  <li>Оприбуткування поставки публікує до 15 товарів за раз.</li>
                </ul>
                <p class="adm-hint" style="margin:0">Будь-який товар можна опублікувати вручну або запланувати на певний час — кнопкою «Опублікувати» в редакторі товару. Вручну правила вище не діють.</p>
              </div>
              <div class="adm-card pad adm-stack" style="gap:12px">
                <div class="adm-section-title">«Новинки тижня» — добірка одним постом</div>
                <label class="adm-switch"><input type="checkbox" [(ngModel)]="s.channel.digestEnabled" /><span class="track"></span> Публікувати щотижня</label>
                @if (s.channel.digestEnabled) {
                  <div class="adm-row nowrap">
                    <select class="select" style="max-width:180px" [(ngModel)]="s.channel.digestDay">@for (d of weekdays; track d.v) { <option [ngValue]="d.v">{{ d.l }}</option> }</select>
                    <span class="small">о</span>
                    <input class="input" type="time" style="max-width:130px" [(ngModel)]="s.channel.digestTime" />
                  </div>
                }
                <p class="adm-hint" style="margin:0">Альбом з першими фото й нумерований список із цінами та посиланнями: товари в наявності, додані або опубліковані як новинка за останні 7 днів (до 10). Якщо нових товарів немає — пост не виходить.</p>
                @if (queue(); as q) {
                  <div class="small">Зараз у добірці: <b>{{ q.digest.products.length }}</b>@if (q.digest.products.length) { — {{ digestNames() }} }</div>
                  @if (q.digest.last) { <div class="adm-hint">Остання добірка: {{ q.digest.last.date }} ({{ q.digest.last.count }} товарів)</div> }
                }
                <div><button class="btn btn-ghost btn-xs" [disabled]="digestBusy()" (click)="postDigest()"><app-icon name="send" [size]="13" /> {{ digestBusy() ? 'Публікуємо…' : 'Опублікувати добірку зараз' }}</button></div>
              </div>
              <div class="adm-card pad adm-stack" style="gap:12px">
                <div class="adm-section-title">Заплановані пости</div>
                @if (queue()?.pending?.length) {
                  <ul class="queue">
                    @for (p of queue()!.pending; track p.id) {
                      <li>
                        <span class="when">{{ p.run_at | date: 'EEE d MMM, HH:mm' }}</span>
                        <span class="grow"><a class="link-plain" [routerLink]="['/admin/products', p.product_id]">{{ p.name }}</a> <span class="adm-muted">· {{ targetLabels[p.target] || p.target }} · {{ kindLabels[p.kind] || p.kind }}@if (p.source === 'manual') { · вручну }</span>
                          @if (p.error) { <span class="adm-hint" style="color:var(--danger);display:block">Повторимо: {{ p.error }}</span> }</span>
                        <button class="icon-btn" title="Скасувати" (click)="cancelPost(p.id)"><app-icon name="close" [size]="15" /></button>
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="adm-hint" style="margin:0">Немає — усе опубліковано.</p>
                }
                <p class="adm-hint" style="margin:0">На безкоштовному тарифі Render сайт «засинає», якщо його ніхто не відкриває 15 хв. Тоді пост вийде, щойно хтось зайде на сайт. Щоб публікації виходили вчасно, можна налаштувати безкоштовний пінг (напр. cron-job.org кожні 10 хв на адресу сайту).</p>
              </div>
            </div>
          }
          @case ('social') {
            <div class="adm-grid adm-grid-2">
              @for (net of nets; track net.key) {
                <div class="adm-card pad adm-stack" style="gap:12px">
                  <div class="adm-between"><div class="adm-section-title" style="margin:0">{{ net.title }}</div>
                    @if (connected(net.key); as c) { <span class="adm-pill ok">Підключено</span> } @else { <span class="adm-pill">Не підключено</span> }</div>
                  @if (social(); as so) {
                    @if (net.key === 'instagram') {
                      @if (so.instagram.connected; as c) {
                        <p class="small" style="margin:0">Акаунт <b>{{ '@' + c.username }}</b>@if (c.via === 'facebook') { — через сторінку Facebook } @else { . Доступ оновлюється автоматично (до {{ c.expiresAt | date: 'd MMM y' }}) }.</p>
                      } @else if (so.facebook.connected) {
                        <p class="adm-hint" style="margin:0;color:var(--warning)">До сторінки «{{ so.facebook.connected.pageName }}» не прив'язано Instagram. Прив'яжіть його (крок 1 інструкції) і натисніть «Підключити» ще раз.</p>
                      }
                    } @else {
                      @if (so.facebook.connected; as c) { <p class="small" style="margin:0">Сторінка <b>{{ c.pageName }}</b></p> }
                      @if (so.facebook.pending.length) {
                        <div class="field"><label class="label">Оберіть сторінку для публікацій</label>
                          <div class="adm-row">@for (p of so.facebook.pending; track p.id) { <button class="btn btn-ghost btn-xs" (click)="choosePage(p.id)">{{ p.name }}</button> }</div></div>
                      }
                    }
                    <label class="adm-switch"><input type="checkbox" [(ngModel)]="s.social[net.key]" /><span class="track"></span> Автопублікація (правила — у вкладці «Автопублікація»)</label>
                    <div class="adm-row">
                      <button class="btn btn-sm" [disabled]="!(so[net.key].configured || so.facebook.configured) || !so.https" (click)="connect(net.key)">{{ connected(net.key) ? 'Перепідключити' : so.instagram.configured ? 'Підключити ' + net.title : 'Підключити Facebook та Instagram' }}</button>
                      @if (connected(net.key)) { <button class="btn btn-ghost btn-xs" (click)="disconnect(net.key)">Відключити</button> }
                    </div>
                    @if (!so.https) { <p class="adm-hint" style="margin:0;color:var(--warning)">Працює лише на опублікованому сайті з https.</p> }
                    @if (!so[net.key].configured && !so.facebook.configured) {
                      <p class="adm-hint" style="margin:0;color:var(--warning)">Спершу створіть застосунок Meta й додайте ключі на Render — інструкція нижче.</p>
                    }

                  }
                </div>
              }
              @if (social(); as so) {
                <div class="adm-card pad adm-stack" style="gap:12px">
                  <div class="adm-section-title">Як підключити (один раз)</div>
                  <p class="small" style="margin:0">Нові застосунки Meta підключають Instagram через вхід Facebook: публікуємо через сторінку Facebook, до якої прив'язаний Instagram. Одна кнопка підключає обидві мережі.</p>
                  <ol class="steps small">
                    <li><b>Сторінка Facebook + Instagram.</b> Instagram — професійний. Створіть сторінку магазину у Facebook і прив'яжіть до неї Instagram: сторінка → Налаштування → <b>Пов'язані облікові записи</b> → Instagram → Підключити (або Meta Business Suite → Налаштування → Облікові записи Instagram).</li>
                    <li>У застосунку Meta: <b>Facebook Login for Business → Settings</b> → «Valid OAuth Redirect URIs»:<br><code class="copy" (click)="copy(so.facebook.redirectUri)">{{ so.facebook.redirectUri }}</code></li>
                    <li><b>Facebook Login for Business → Configurations → Create</b>: тип токена «User access token»; ресурси — <b>Сторінки</b> та <b>Облікові записи Instagram</b>; дозволи — <code>pages_show_list</code>, <code>pages_read_engagement</code>, <code>pages_manage_posts</code>, <code>instagram_basic</code>, <code>instagram_content_publish</code>, <code>business_management</code>. Скопіюйте <b>Configuration ID</b>.</li>
                    <li><b>App settings → Basic</b>: App ID і App Secret.</li>
                    <li>Render → Environment: <code>META_APP_ID</code>, <code>META_APP_SECRET</code>, <code>META_LOGIN_CONFIG_ID</code> (Configuration ID) → Save.</li>
                    <li>Тут натисніть «Підключити Facebook та Instagram», увійдіть і виберіть сторінку та Instagram магазину.</li>
                  </ol>
                  @if (so.facebook.configured && !so.facebook.businessLogin) { <p class="adm-hint" style="margin:0;color:var(--warning)">META_LOGIN_CONFIG_ID не вказано — вхід піде зі стандартним набором дозволів. Якщо Meta відповість помилкою, додайте Configuration ID.</p> }
                  <p class="adm-hint" style="margin:0">Назви пунктів у кабінеті Meta іноді змінюються — якщо щось виглядає інакше, надішліть скріншот. Поки застосунок у режимі розробки, публікувати можна у власні акаунти (ви — адміністратор застосунку).</p>
                </div>
              }
              <div class="adm-card pad adm-stack" style="gap:12px">
                <div class="adm-section-title">Як виглядають пости</div>
                <ul class="steps small">
                  <li><b>Instagram:</b> карусель до 4 фото (одне — якщо фото одне), назва, ціна, опис, розміри й «Замовити — посилання в профілі». Посилання в підписах Instagram не клікабельні, тож додайте посилання на сайт у профіль.</li>
                  <li><b>Facebook:</b> фото або кілька фото, той самий текст і клікабельне посилання на товар.</li>
                  <li>Фото автоматично готуються під Instagram: 1080×1350 (4:5), JPEG.</li>
                  <li>«Новинки тижня» виходить у всі підключені мережі одночасно.</li>
                </ul>
                <div class="field"><label class="label">Хештеги під постами</label><input class="input" [(ngModel)]="s.social.hashtags" placeholder="#amina #одяг" /></div>
              </div>
            </div>
          }
          @case ('notifications') {
            <div class="adm-grid adm-grid-2">
              <div class="adm-card pad adm-stack" style="gap:12px">
                <div class="adm-section-title">Кому надсилати нові замовлення</div>
                <div class="field">
                  <label class="label">Email адміністраторів (через кому)</label>
                  <input class="input" [ngModel]="list(s.notifications.adminEmails)" (ngModelChange)="s.notifications.adminEmails = split($event)" placeholder="you@gmail.com" />
                  <div class="adm-row"><button class="btn btn-ghost btn-xs" (click)="test('email')"><app-icon name="send" [size]="13" /> Надіслати тест</button></div>
                </div>
                <div class="field">
                  <label class="label">Telegram chat ID (через кому)</label>
                  <input class="input" [ngModel]="list(s.notifications.telegramAdminChatIds)" (ngModelChange)="s.notifications.telegramAdminChatIds = split($event)" placeholder="342585697" />
                  <div class="adm-hint">Тут потрібні цифри, а не ім'я бота чи каналу. Напишіть боту @if (i()?.telegramBot) { <a class="link-plain" [href]="'https://t.me/' + i()!.telegramBot" target="_blank">{{ '@' + i()!.telegramBot }}</a> } команду <b>/id</b> — він відповість вашим chat ID. Канал для постів вказується у вкладці «Telegram».</div>
                  @if (badChatIds(s.notifications.telegramAdminChatIds).length) {
                    <div class="adm-hint" style="color:var(--danger)">«{{ badChatIds(s.notifications.telegramAdminChatIds).join(', ') }}» — це не chat ID. Вкажіть числовий ID, наприклад 342585697.</div>
                  }
                  <div class="adm-row">
                    <button class="btn btn-ghost btn-xs" (click)="test('telegram')"><app-icon name="send" [size]="13" /> Надіслати тест</button>
                    <button class="btn btn-ghost btn-xs" (click)="reconnectTelegram()"><app-icon name="refresh" [size]="13" /> Перепідключити бота</button>
                  </div>
                </div>
                <div class="field">
                  <label class="label">Viber ID (через кому)</label>
                  <input class="input" [ngModel]="list(s.notifications.viberAdminIds)" (ngModelChange)="s.notifications.viberAdminIds = split($event)" />
                </div>
              </div>
              <div class="adm-card pad adm-stack" style="gap:14px">
                <div class="adm-section-title">Повідомлення клієнтам</div>
                <label class="adm-switch"><input type="checkbox" [(ngModel)]="s.notifications.notifyCustomerEmail" /><span class="track"></span> Листи клієнтам (підтвердження, зміна статусу)</label>
                <p class="adm-hint" style="margin:-6px 0 0 46px">Без власного домену в Resend листи доходять лише на email вашого акаунта — тоді вимкніть.</p>
                <label class="adm-switch"><input type="checkbox" [(ngModel)]="s.notifications.notifyCustomerWhatsapp" /><span class="track"></span> WhatsApp-повідомлення клієнтам</label>
                <label class="adm-switch"><input type="checkbox" [(ngModel)]="s.notifications.notifyAdminOnChatHandoff" /><span class="track"></span> Сповіщати, коли клієнт у чаті просить менеджера</label>
                <p class="adm-hint" style="margin:0">Клієнти також можуть підписатися на статус замовлення в Telegram / Viber зі сторінки замовлення.</p>
              </div>
            </div>
          }
          @case ('chatbot') {
            <div class="adm-card pad adm-stack" style="gap:14px;max-width:760px">
              <label class="adm-switch"><input type="checkbox" [(ngModel)]="s.chatbot.enabled" /><span class="track"></span> Показувати чат на сайті</label>
              <div class="form-grid">
                <div class="field"><label class="label">Ім'я помічниці</label><input class="input" [(ngModel)]="s.chatbot.botName" /></div>
                <div class="field full"><label class="label">Привітання</label><textarea class="textarea" rows="2" [(ngModel)]="s.chatbot.greeting"></textarea></div>
                <div class="field full"><label class="label">Додаткові інструкції для бота</label>
                  <textarea class="textarea" rows="5" [(ngModel)]="s.chatbot.instructions" placeholder="Напр.: Завжди пропонуй підписатися на Instagram. Знижка 5% при оплаті на банку."></textarea>
                  <div class="adm-hint">Бот уже знає контакти, доставку, оплату, FAQ і бачить каталог та замовлення. Режим: {{ i()?.chatbotAi ? 'AI (Claude)' : 'простий — FAQ і пошук (додайте ANTHROPIC_API_KEY на Render для AI)' }}.</div>
                </div>
              </div>
            </div>
          }
          @case ('analytics') {
            <div class="adm-grid adm-grid-2">
              <div class="adm-card pad adm-stack" style="gap:12px">
                <div class="adm-section-title">Google Analytics 4</div>
                <div class="field">
                  <label class="label">Measurement ID</label>
                  <input class="input" [(ngModel)]="s.analytics.ga4Id" placeholder="G-XXXXXXXXXX" />
                  <div class="adm-hint">analytics.google.com → Адміністрування → Потоки даних → Веб → «Ідентифікатор показника».</div>
                </div>
              </div>
              <div class="adm-card pad adm-stack" style="gap:12px">
                <div class="adm-section-title">Meta Pixel (Facebook / Instagram)</div>
                <div class="field">
                  <label class="label">Pixel ID</label>
                  <input class="input" [(ngModel)]="s.analytics.metaPixelId" placeholder="123456789012345" />
                  <div class="adm-hint">business.facebook.com → Events Manager → джерело даних → «Ідентифікатор пікселя» (лише цифри).</div>
                </div>
              </div>
            </div>
            <div class="adm-card pad" style="margin-top:16px">
              <div class="adm-section-title">Що відстежується</div>
              <p class="adm-hint" style="margin:0">Перегляди сторінок, перегляд товару, додавання в кошик, початок оформлення та покупка з сумою і складом замовлення — у форматі e-commerce GA4 і стандартних подій Meta (ViewContent, AddToCart, InitiateCheckout, Purchase). Адмінка не відстежується. Порожнє поле — скрипт не завантажується.</p>
            </div>
          }
          @case ('integrations') {
            <div class="adm-card">
              <ul class="adm-list" style="padding:0 18px">
                @for (x of integrations(); track x.name) {
                  <li>
                    <span class="adm-dot" [class.on]="x.on"></span>
                    <div style="flex:1;min-width:0"><b>{{ x.name }}</b><div class="small adm-muted">{{ x.on ? x.okText : x.howTo }}</div></div>
                    <span class="adm-pill" [class.ok]="x.on">{{ x.on ? 'Підключено' : 'Не налаштовано' }}</span>
                  </li>
                }
              </ul>
              <p class="adm-hint" style="padding:0 18px 16px;margin:0">Ключі додаються в Render → сервіс amina → Environment. Після збереження сервіс перезапуститься сам.</p>
            </div>
          }
        }
        @if (tab() !== 'integrations') {
          <div class="adm-sticky-bar">
            @if (dirty()) { <span class="small adm-muted">Є незбережені зміни</span> }
            <button class="btn btn-sm" [disabled]="busy()" (click)="save()">Зберегти</button>
          </div>
        }
      } @else {
        <div class="adm-empty"><span class="spinner"></span></div>
      }
    </div>
  `,
  styles: `
    .qr-card { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; }
    .guide summary { cursor: pointer; font-size: 13px; font-weight: 600; }
    .guide[open] summary { margin-bottom: 8px; }
    .copy { cursor: copy; word-break: break-all; }
    .queue { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .queue li { display: flex; align-items: flex-start; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
    .queue .when { width: 130px; flex: none; color: var(--ink-2); font-variant-numeric: tabular-nums; }
    .queue .grow { flex: 1; min-width: 0; }
    .steps { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; color: var(--ink-2); }
    .nowrap { flex-wrap: nowrap; }
    code { font-size: 12px; background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }
    .qr { width: 200px; height: 200px; border-radius: 8px; border: 1px solid var(--line); }
  `,
})
export class SettingsPage {
  private api = inject(AdminApi);
  private toasts = inject(Toasts);
  protected tabs: { v: Tab; l: string }[] = [
    { v: 'store', l: 'Магазин' },
    { v: 'payment', l: 'Оплата' },
    { v: 'np', l: 'Нова пошта' },
    { v: 'notifications', l: 'Сповіщення' },
    { v: 'telegram', l: 'Telegram' },
    { v: 'social', l: 'Instagram і Facebook' },
    { v: 'autopost', l: 'Автопублікація' },
    { v: 'chatbot', l: 'Чат-бот' },
    { v: 'analytics', l: 'Аналітика' },
    { v: 'integrations', l: 'Інтеграції' },
  ];
  protected storeFields = STORE_FIELDS;
  protected tab = signal<Tab>('store');
  protected s = signal<S | null>(null);
  protected i = signal<AdminSettings['integrations'] | null>(null);
  protected busy = signal(false);
  protected qr = signal('');
  private saved = '';
  /** Bumped on every keystroke-free check; ngModel mutates the object in place. */
  protected dirty = () => !!this.s() && JSON.stringify(this.s()) !== this.saved;

  protected sampleLink = computed(() => this.jar(this.s()?.payment.monoJarUrl ?? ''));
  protected integrations = computed(() => {
    const i = this.i();
    if (!i) return [];
    return [
      { name: 'Email (Resend / SMTP)', on: i.email, okText: 'Листи надсилаються', howTo: 'Додайте RESEND_API_KEY і MAIL_FROM' },
      { name: 'Telegram-бот', on: i.telegram, okText: `Бот @${i.telegramBot}`, howTo: 'Додайте TELEGRAM_BOT_TOKEN і TELEGRAM_BOT_USERNAME' },
      { name: 'Viber-бот', on: i.viber, okText: 'Підключено', howTo: 'Додайте VIBER_BOT_TOKEN і VIBER_BOT_URI' },
      { name: 'WhatsApp Cloud API', on: i.whatsapp, okText: 'Підключено', howTo: 'Додайте WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE' },
      { name: 'Оплата карткою (monobank еквайринг)', on: i.monobankAcquiring, okText: 'Онлайн-оплата доступна', howTo: 'Додайте MONOBANK_TOKEN' },
      { name: 'Нова пошта (підказки міст і відділень)', on: i.novaPoshta, okText: 'Підказки працюють', howTo: 'Додайте NOVA_POSHTA_API_KEY' },
      { name: 'AI чат-бот (Claude)', on: i.chatbotAi, okText: 'Розумний режим', howTo: 'Додайте ANTHROPIC_API_KEY (без нього — простий режим)' },
    ];
  });

  constructor() {
    // back from Meta's login page: /admin/settings?tab=social&connected=instagram | error=… | choose=facebook
    const q = inject(ActivatedRoute).snapshot.queryParamMap;
    const tab = q.get('tab') as Tab | null;
    if (tab && this.tabs.some((t) => t.v === tab)) this.tab.set(tab);
    const done = q.get('connected');
    if (done) this.toasts.success(`${done === 'instagram' ? 'Instagram' : 'Facebook'} підключено ✓`);
    if (q.get('choose')) this.toasts.show('Оберіть сторінку Facebook для публікацій');
    if (q.get('error')) this.toasts.error(`Не вдалося підключити: ${q.get('error')}`);
    this.api.get<AdminSettings>('/settings').subscribe((r) => {
      this.s.set(r.settings);
      this.i.set(r.integrations);
      this.saved = JSON.stringify(r.settings);
      this.renderQr();
    });
    effect(() => {
      if (this.tab() === 'payment') this.renderQr();
      if (this.tab() === 'autopost') {
        this.loadQueue();
        this.loadSocial();
      }
      if (this.tab() === 'social') this.loadSocial();
    });
  }

  private jar(url: string) {
    if (!url) return '';
    try {
      const u = new URL(url);
      u.searchParams.set('a', '1250');
      u.searchParams.set('t', 'Оплата замовлення AM-1001');
      return u.toString();
    } catch {
      return '';
    }
  }

  renderQr() {
    const link = this.jar(this.s()?.payment.monoJarUrl ?? '');
    if (!link) return this.qr.set('');
    QRCode.toDataURL(link, { margin: 1, width: 400, color: { dark: '#1f1d1a', light: '#ffffff' } }).then((d) => this.qr.set(d));
  }

  /** Admin chat IDs are numbers (groups are negative); names like @SomeBot can't receive messages from the bot. */
  badChatIds(ids: string[]) {
    return (ids ?? []).filter((id) => !/^-?\d{5,20}$/.test(id));
  }

  protected weekdays = [
    { v: 1, l: 'Понеділок' }, { v: 2, l: 'Вівторок' }, { v: 3, l: 'Середа' }, { v: 4, l: 'Четвер' },
    { v: 5, l: 'Пʼятниця' }, { v: 6, l: 'Субота' }, { v: 7, l: 'Неділя' },
  ];
  protected delays = [
    { v: 0, l: 'Не чекати' }, { v: 5, l: '5 хвилин' }, { v: 15, l: '15 хвилин' }, { v: 30, l: '30 хвилин' }, { v: 60, l: '1 годину' }, { v: 120, l: '2 години' },
  ];
  protected kindLabels: Record<string, string> = { new: 'новинка', restock: 'знову в наявності', sale: 'знижка', preorder: 'передзамовлення', incoming: 'в дорозі', plain: 'без позначки' };
  protected targetLabels: Record<string, string> = { telegram: 'Telegram', instagram: 'Instagram', facebook: 'Facebook' };
  protected queue = signal<ChannelQueue | null>(null);
  protected digestBusy = signal(false);
  protected digestNames = computed(() => (this.queue()?.digest.products ?? []).slice(0, 4).map((p) => p.name).join(', ') + ((this.queue()?.digest.products.length ?? 0) > 4 ? '…' : ''));

  loadQueue() {
    this.api.get<ChannelQueue>('/channel/queue').subscribe((q) => this.queue.set(q));
  }

  cancelPost(id: number) {
    this.api.delete(`/channel/queue/${id}`).subscribe({
      next: () => {
        this.toasts.show('Пост скасовано');
        this.loadQueue();
      },
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }

  postDigest() {
    this.digestBusy.set(true);
    this.api.post<{ count: number }>('/channel/digest', {}).subscribe({
      next: (r) => {
        this.digestBusy.set(false);
        this.toasts.success(`Добірку з ${r.count} товарів опубліковано`);
        this.loadQueue();
      },
      error: (e) => {
        this.digestBusy.set(false);
        this.toasts.error(errorMessage(e));
      },
    });
  }

  protected nets: { key: 'instagram' | 'facebook'; title: string }[] = [
    { key: 'instagram', title: 'Instagram' },
    { key: 'facebook', title: 'Facebook' },
  ];
  protected social = signal<SocialStatus | null>(null);

  loadSocial() {
    this.api.get<SocialStatus>('/social').subscribe((r) => this.social.set(r));
  }

  connected(net: 'instagram' | 'facebook') {
    return this.social()?.[net].connected ?? null;
  }

  connect(net: 'instagram' | 'facebook') {
    // unsaved changes would be lost on the round trip through Meta's login page
    if (this.dirty()) {
      this.toasts.error('Спершу збережіть зміни');
      return;
    }
    this.api.get<{ url: string }>(`/social/connect/${net}`).subscribe({
      next: (r) => (location.href = r.url),
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }

  disconnect(net: 'instagram' | 'facebook') {
    this.api.delete(`/social/${net}`).subscribe({
      next: () => {
        this.toasts.show('Відключено');
        this.loadSocial();
      },
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }

  choosePage(pageId: string) {
    this.api.post('/social/facebook/page', { pageId }).subscribe({
      next: () => {
        this.toasts.success('Сторінку Facebook підключено');
        this.loadSocial();
      },
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }

  copy(text: string) {
    navigator.clipboard?.writeText(text).then(() => this.toasts.show('Скопійовано'));
  }

  testChannel() {
    const chatId = this.s()?.channel.chatId.trim();
    if (!chatId) return;
    this.api.post('/channel/test', { chatId }).subscribe({
      next: () => this.toasts.success('Тестове повідомлення опубліковано в каналі'),
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }

  list(v: string[]) {
    return (v ?? []).join(', ');
  }
  split(v: string) {
    return v.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  }

  save() {
    const s = this.s();
    if (!s) return;
    this.busy.set(true);
    this.api.put<S>('/settings', s).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.s.set(r);
        this.saved = JSON.stringify(r);
        this.renderQr();
        this.toasts.success('Налаштування збережено');
      },
      error: (e) => {
        this.busy.set(false);
        this.toasts.error(errorMessage(e));
      },
    });
  }

  test(channel: 'email' | 'telegram') {
    if (this.dirty()) {
      this.toasts.show('Спершу збережіть налаштування');
      return;
    }
    this.api.post<{ to: string; ok: boolean; error?: string }[]>('/settings/test-notification', { channel }).subscribe({
      next: (r) => {
        const failed = r.filter((x) => !x.ok);
        if (failed.length) this.toasts.error(`Не вдалося: ${failed.map((f) => `${f.to} — ${f.error}`).join('; ')}`);
        else this.toasts.success(`Тест надіслано: ${r.map((x) => x.to).join(', ')}`);
      },
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }

  checkNp() {
    this.api.get<{ name: string }>('/np/sender').subscribe({
      next: (r) => this.toasts.success(`Підключено. Відправник: ${r.name}`),
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }

  reconnectTelegram() {
    this.api.post<{ ok: boolean; info: { url: string; pending_update_count: number; last_error_message?: string } }>('/integrations/telegram/webhook').subscribe({
      next: (r) => this.toasts.success(r.info.last_error_message ? `Підключено, остання помилка Telegram: ${r.info.last_error_message}` : 'Бот підключено ✓'),
      error: (e) => this.toasts.error(errorMessage(e)),
    });
  }
}
