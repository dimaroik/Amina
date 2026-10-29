import { Directive, ElementRef, OnDestroy, OnInit, inject, input } from '@angular/core';

/** Fades an element in when it scrolls into view. Usage: <section appReveal [revealDelay]="100"> */
@Directive({ selector: '[appReveal]', host: { class: 'reveal' } })
export class Reveal implements OnInit, OnDestroy {
  private el = inject(ElementRef<HTMLElement>);
  readonly revealDelay = input(0);
  private observer?: IntersectionObserver;

  ngOnInit() {
    const node = this.el.nativeElement;
    if (!('IntersectionObserver' in window)) {
      node.classList.add('revealed');
      return;
    }
    node.style.transitionDelay = `${this.revealDelay()}ms`;
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            node.classList.add('revealed');
            this.observer?.disconnect();
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );
    this.observer.observe(node);
  }

  ngOnDestroy() {
    this.observer?.disconnect();
  }
}
