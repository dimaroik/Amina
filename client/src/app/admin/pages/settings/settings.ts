import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import QRCode from 'qrcode';
import { errorMessage } from '../../../core/api.service';
import { Toasts } from '../../../core/toast.service';
import { Icon } from '../../../shared/icon';
import { AdminApi, type AdminSettings } from '../../admin-api';
import { NpPicker } from '../../ui/np-picker';

type Tab = 'store' | 'payment' | 'np' | 'notifications' | 'telegram' | 'chatbot' | 'analytics' | 'integrations';
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
  imports: [FormsModule, Icon, NpPicker],
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
                <label class="adm-switch"><input type="checkbox" [(ngModel)]="s.channel.postOnReceive" /><span class="track"></span> Публікувати новинки, коли поставку оприбутковано</label>
                <label class="adm-switch"><input type="checkbox" [(ngModel)]="s.channel.postOnAnnounce" /><span class="track"></span> Публікувати «Уже в дорозі / Передзамовлення», коли поставку показано на сайті</label>
                <p class="adm-hint" style="margin:0">Пост: перше фото товару, назва, ціна (і знижка), опис, розміри, кольори та кнопка на сторінку товару. Будь-який товар можна опублікувати вручну — кнопкою «Telegram» у редакторі товару.</p>
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
                  <div class="adm-hint">Напишіть боту @if (i()?.telegramBot) { <a class="link-plain" [href]="'https://t.me/' + i()!.telegramBot" target="_blank">{{ '@' + i()!.telegramBot }}</a> } команду <b>/id</b> — він відповість вашим chat ID.</div>
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
    this.api.get<AdminSettings>('/settings').subscribe((r) => {
      this.s.set(r.settings);
      this.i.set(r.integrations);
      this.saved = JSON.stringify(r.settings);
      this.renderQr();
    });
    effect(() => {
      if (this.tab() === 'payment') this.renderQr();
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
