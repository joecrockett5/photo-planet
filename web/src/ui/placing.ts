import type { MediaItem } from '../api';
import { h } from './dom';
import { icon } from './icons';

/**
 * Placement mode: shows which item is being placed and how to cancel; the
 * next tap on the planet sets its location.
 */
export class Placing {
  private el: HTMLElement;
  private thumb = h('span.placing-thumb');
  item: MediaItem | null = null;
  onChange: ((item: MediaItem | null) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.el = h(
      'div.placing',
      { hidden: true, role: 'status' },
      this.thumb,
      h('span', {}, 'Tap where this was taken'),
      h('button.icon-button', { 'aria-label': 'Cancel', onclick: () => this.cancel() }, icon('close')),
    );
    parent.append(this.el);
  }

  start(item: MediaItem): void {
    this.item = item;
    this.thumb.replaceChildren(item.thumbUrl ? h('img', { src: item.thumbUrl, alt: '' }) : '');
    this.el.hidden = false;
    document.body.classList.add('placing-mode');
    this.onChange?.(item);
  }

  cancel(): void {
    if (!this.item) return;
    this.item = null;
    this.el.hidden = true;
    document.body.classList.remove('placing-mode');
    this.onChange?.(null);
  }

  get active(): boolean {
    return this.item !== null;
  }
}
