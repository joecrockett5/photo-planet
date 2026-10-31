import type { MediaItem } from '../api';
import { byDate, dayKey, describeItems, formatDay, formatDuration } from '../format';
import { h } from './dom';
import { icon } from './icons';
import { placeName } from './place';

/**
 * The items at one place: a side panel on wide screens, a bottom sheet on
 * phones. Thumbnails grouped by day, oldest first.
 */
export class Gallery {
  readonly el: HTMLElement;
  private title = h('h2.gallery-title');
  private sub = h('p.gallery-sub');
  private grid = h('div.gallery-grid');
  private ids: string[] = [];
  private items: MediaItem[] = [];
  private placeToken = 0;
  isOpen = false;
  onClose: (() => void) | null = null;
  onOpenItem: ((items: MediaItem[], index: number) => void) | null = null;

  constructor(parent: HTMLElement) {
    const close = h('button.icon-button.gallery-close', { 'aria-label': 'Close', onclick: () => this.close() }, icon('close'));
    this.el = h(
      'aside.gallery',
      { 'aria-label': 'Photos here', hidden: true },
      h('header.gallery-head', {}, h('div', {}, this.title, this.sub), close),
      this.grid,
    );
    parent.append(this.el);
  }

  open(items: MediaItem[]): void {
    this.ids = items.map((i) => i.id);
    this.isOpen = true;
    this.el.hidden = false;
    this.render(items);
    this.grid.scrollTop = 0;
    requestAnimationFrame(() => this.el.classList.add('open'));
    const token = ++this.placeToken;
    this.title.textContent = '';
    void placeName(items).then((name) => {
      if (token === this.placeToken) this.title.textContent = name || 'Somewhere';
    });
  }

  /** Keep in sync with the store: drop deleted or moved-away items, refresh statuses. */
  update(all: MediaItem[]): void {
    if (!this.isOpen) return;
    const byId = new Map(all.map((i) => [i.id, i]));
    const items = this.ids.map((id) => byId.get(id)).filter((i): i is MediaItem => !!i && i.lat !== null);
    this.ids = items.map((i) => i.id);
    if (!items.length) return this.close();
    this.render(items);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('open');
    this.el.hidden = true;
    this.onClose?.();
  }

  private render(items: MediaItem[]) {
    this.items = [...items].sort(byDate);
    this.sub.textContent = describeItems(this.items);
    const groups = new Map<string | null, MediaItem[]>();
    for (const item of this.items) {
      const key = dayKey(item);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    const frag = document.createDocumentFragment();
    for (const [day, dayItems] of groups) {
      frag.append(h('h3.gallery-day', {}, formatDay(day)));
      const row = h('div.gallery-thumbs');
      for (const item of dayItems) row.append(this.thumb(item));
      frag.append(row);
    }
    this.grid.replaceChildren(frag);
  }

  private thumb(item: MediaItem): HTMLElement {
    const index = this.items.indexOf(item);
    const label = `${item.kind === 'video' ? 'Video' : 'Photo'} ${item.name}`;
    const btn = h('button.thumb', { 'aria-label': label, onclick: () => this.onOpenItem?.(this.items, index) });
    if (item.thumbUrl) {
      btn.append(h('img', { src: item.thumbUrl, alt: '', loading: 'lazy', decoding: 'async' }));
    } else {
      btn.append(h('span.thumb-empty', {}, item.status === 'processing' ? '...' : '?'));
    }
    if (item.kind === 'video') btn.append(h('span.thumb-badge', {}, icon('play'), formatDuration(item.duration)));
    return btn;
  }
}
