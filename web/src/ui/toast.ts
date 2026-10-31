import { h } from './dom';

/** A single quiet line of text near the bottom, with an optional action. */
export class Toast {
  private el = h('div.toast', { role: 'status', hidden: true });
  private timer: number | undefined;

  constructor(parent: HTMLElement) {
    parent.append(this.el);
  }

  show(text: string, action?: { label: string; run: () => void }, ms = 5000): void {
    clearTimeout(this.timer);
    this.el.replaceChildren(text);
    if (action) {
      this.el.append(
        h('button.text-button', {
          onclick: () => {
            this.hide();
            action.run();
          },
        }, action.label),
      );
    }
    this.el.hidden = false;
    this.timer = window.setTimeout(() => this.hide(), ms);
  }

  hide(): void {
    this.el.hidden = true;
  }
}
