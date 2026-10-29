import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api.service';
import type { ChatMessage } from '../../core/models';
import { storage } from '../../core/storage';
import { Store } from '../../core/store.service';
import { Icon } from '../../shared/icon';
import { UahPipe } from '../../shared/uah.pipe';

const QUICK = ['Як обрати розмір?', 'Доставка і оплата', 'Де моє замовлення?', 'Порадь сукню', 'Зв’язатися з менеджером'];

@Component({
  selector: 'app-chat-widget',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, UahPipe],
  template: `
    @if (enabled()) {
      <button class="fab" [class.hidden]="open()" (click)="toggle()" aria-label="Чат з помічницею">
        <app-icon name="chat" [size]="22" />
        @if (!seen()) { <span class="ping"></span> }
      </button>

      <section class="panel" [class.open]="open()" aria-label="Чат" [attr.aria-hidden]="!open()">
        <header class="head">
          <div class="avatar">{{ botName().charAt(0) }}</div>
          <div class="who">
            <div class="name">{{ botName() }}</div>
            <div class="status"><span class="dot"></span> Онлайн · відповідаю миттєво</div>
          </div>
          <button class="icon-btn" (click)="toggle()" aria-label="Згорнути"><app-icon name="chevron-down" /></button>
        </header>

        <div class="messages" #scroller>
          <div class="msg bot"><div class="bubble">{{ greeting() }}</div></div>
          @for (m of messages(); track $index) {
            <div class="msg" [class.bot]="m.role === 'assistant'" [class.me]="m.role === 'user'">
              <div class="bubble">{{ m.text }}</div>
              @if (m.products?.length) {
                <div class="products">
                  @for (p of m.products; track p.id) {
                    <a class="product" [routerLink]="['/product', p.slug]" (click)="onProductClick()">
                      <div class="pimg">@if (p.images[0]) { <img [src]="p.images[0]" [alt]="p.name" /> }</div>
                      <div class="pname">{{ p.name }}</div>
                      <div class="pprice">{{ p.price | uah }}</div>
                    </a>
                  }
                </div>
              }
            </div>
          }
          @if (typing()) {
            <div class="msg bot"><div class="bubble typing"><i></i><i></i><i></i></div></div>
          }
        </div>

        @if (!messages().length) {
          <div class="quick">
            @for (q of quick; track q) { <button class="chip" (click)="send(q)">{{ q }}</button> }
          </div>
        }

        <form class="composer" (submit)="submit($event)">
          <input #input [value]="draft()" (input)="draft.set($any($event.target).value)" placeholder="Напишіть повідомлення…" maxlength="1000" aria-label="Повідомлення" />
          <button class="send" [disabled]="!draft().trim() || typing()" aria-label="Надіслати"><app-icon name="send" [size]="18" /></button>
        </form>
      </section>
    }
  `,
  styles: `
    .fab { position: fixed; right: 20px; bottom: 20px; z-index: 250; width: 58px; height: 58px; border-radius: 50%; border: 0; background: var(--ink); color: var(--bg); display: grid; place-items: center; box-shadow: var(--shadow-lg); transition: transform .3s var(--ease), opacity .3s; }
    .fab:hover { transform: translateY(-2px) scale(1.04); }
    .fab.hidden { opacity: 0; transform: scale(.6); pointer-events: none; }
    .ping { position: absolute; top: 10px; right: 10px; width: 10px; height: 10px; border-radius: 50%; background: #c99a7a; box-shadow: 0 0 0 0 rgba(201,154,122,.7); animation: ping 1.8s infinite; }
    @keyframes ping { 70% { box-shadow: 0 0 0 10px rgba(201,154,122,0); } 100% { box-shadow: 0 0 0 0 rgba(201,154,122,0); } }
    .panel { position: fixed; z-index: 260; right: 20px; bottom: 20px; width: min(390px, calc(100vw - 24px)); height: min(620px, calc(100dvh - 40px)); background: var(--bg); box-shadow: var(--shadow-lg); border: 1px solid var(--line); display: flex; flex-direction: column; transform-origin: bottom right; transform: scale(.9) translateY(10px); opacity: 0; pointer-events: none; transition: all .35s var(--ease); border-radius: 14px; overflow: hidden; }
    .panel.open { transform: none; opacity: 1; pointer-events: auto; }
    @media (max-width: 599px) { .panel { right: 0; bottom: 0; width: 100vw; height: 100dvh; border-radius: 0; } .fab { right: 14px; bottom: 14px; } }
    .head { display: flex; align-items: center; gap: 12px; padding: 14px 10px 14px 16px; background: var(--ink); color: var(--bg); }
    .head .icon-btn { color: var(--bg); }
    .head .icon-btn:hover { background: rgba(255,255,255,.1); }
    .avatar { width: 38px; height: 38px; border-radius: 50%; background: var(--accent-soft); color: var(--ink); display: grid; place-items: center; font-family: var(--font-serif); font-size: 20px; }
    .who { flex: 1; }
    .name { font-weight: 600; font-size: 14px; }
    .status { font-size: 11px; opacity: .75; display: flex; align-items: center; gap: 6px; }
    .status .dot { width: 6px; height: 6px; border-radius: 50%; background: #9cc59a; }
    .messages { flex: 1; overflow-y: auto; padding: 18px 14px; display: flex; flex-direction: column; gap: 10px; background: var(--surface-2); }
    .msg { display: flex; flex-direction: column; max-width: 86%; animation: rise .3s var(--ease); }
    @keyframes rise { from { opacity: 0; transform: translateY(6px); } }
    .msg.me { align-self: flex-end; align-items: flex-end; }
    .bubble { padding: 10px 14px; border-radius: 16px; font-size: 14px; line-height: 1.5; white-space: pre-line; word-break: break-word; }
    .bot .bubble { background: var(--surface); border-bottom-left-radius: 4px; }
    .me .bubble { background: var(--ink); color: var(--bg); border-bottom-right-radius: 4px; }
    .typing { display: flex; gap: 4px; padding: 14px 16px; }
    .typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); animation: blink 1.2s infinite; }
    .typing i:nth-child(2) { animation-delay: .2s; } .typing i:nth-child(3) { animation-delay: .4s; }
    @keyframes blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
    .products { display: flex; gap: 8px; overflow-x: auto; margin-top: 8px; padding-bottom: 4px; max-width: 330px; scrollbar-width: thin; }
    .product { flex: 0 0 110px; background: var(--surface); padding: 6px; border-radius: 8px; font-size: 12px; transition: transform .2s; }
    .product:hover { transform: translateY(-2px); }
    .pimg { aspect-ratio: 3/4; background: var(--surface-2); border-radius: 4px; overflow: hidden; margin-bottom: 6px; }
    .pimg img { width: 100%; height: 100%; object-fit: cover; }
    .pname { line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .pprice { color: var(--muted); margin-top: 2px; }
    .quick { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 14px; background: var(--surface-2); }
    .quick .chip { min-height: 32px; font-size: 12px; }
    .composer { display: flex; align-items: center; gap: 8px; padding: 10px 10px 10px 16px; border-top: 1px solid var(--line); background: var(--surface); }
    .composer input { flex: 1; border: 0; outline: none; background: transparent; font-size: 14px; min-height: 40px; min-width: 0; }
    .send { width: 40px; height: 40px; border-radius: 50%; border: 0; background: var(--ink); color: var(--bg); display: grid; place-items: center; transition: opacity .2s; }
    .send:disabled { opacity: .3; cursor: default; }
  `,
})
export class ChatWidget {
  private api = inject(Api);
  private store = inject(Store);
  private scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private input = viewChild<ElementRef<HTMLInputElement>>('input');

  protected quick = QUICK;
  protected open = signal(false);
  protected seen = signal(storage.get<boolean>('amina.chat.seen', false));
  protected draft = signal('');
  protected typing = signal(false);
  protected messages = signal<ChatMessage[]>([]);
  private sessionId = storage.get<string | null>('amina.chat.session', null);
  private loaded = false;

  protected enabled = computed(() => this.store.settings()?.chatbot.enabled ?? false);
  protected botName = computed(() => this.store.settings()?.chatbot.botName || 'Аміна');
  protected greeting = computed(() => this.store.settings()?.chatbot.greeting || 'Вітаю! Чим можу допомогти?');

  constructor() {
    effect(() => {
      this.messages();
      this.typing();
      queueMicrotask(() => {
        const el = this.scroller()?.nativeElement;
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      });
    });
  }

  toggle() {
    this.open.update((v) => !v);
    if (this.open()) {
      this.seen.set(true);
      storage.set('amina.chat.seen', true);
      this.loadHistory();
      setTimeout(() => this.input()?.nativeElement.focus(), 250);
    }
  }

  private loadHistory() {
    if (this.loaded || !this.sessionId) return;
    this.loaded = true;
    this.api.get<{ transcript: ChatMessage[] }>(`/chat/${this.sessionId}`).subscribe({
      next: (r) => this.messages.set(r.transcript),
      error: () => {
        this.sessionId = null;
        storage.remove('amina.chat.session');
      },
    });
  }

  submit(e: Event) {
    e.preventDefault();
    this.send(this.draft());
  }

  send(text: string) {
    const message = text.trim();
    if (!message || this.typing()) return;
    this.draft.set('');
    this.messages.update((m) => [...m, { role: 'user', text: message, at: new Date().toISOString() }]);
    this.typing.set(true);
    this.api.post<{ sessionId: string; reply: ChatMessage }>('/chat', { sessionId: this.sessionId ?? undefined, message }).subscribe({
      next: (r) => {
        this.sessionId = r.sessionId;
        storage.set('amina.chat.session', r.sessionId);
        this.typing.set(false);
        this.messages.update((m) => [...m, r.reply]);
      },
      error: (err) => {
        this.typing.set(false);
        this.messages.update((m) => [...m, { role: 'assistant', text: errorMessage(err, 'Не вдалося надіслати. Спробуйте ще раз.'), at: new Date().toISOString() }]);
      },
    });
  }

  onProductClick() {
    if (window.innerWidth < 600) this.open.set(false);
  }
}
