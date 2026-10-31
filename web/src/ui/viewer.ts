import type { MediaItem } from '../api';
import { dayKey, formatDay } from '../format';
import { h } from './dom';
import { icon } from './icons';
import { placeName } from './place';

export interface ViewerAction {
  label: string;
  icon: Parameters<typeof icon>[0];
  run: (item: MediaItem) => void;
  /** Ask again before running: the button turns into this text first. */
  confirm?: string;
  danger?: boolean;
}

/** Full-screen viewer: swipe or arrow keys to move, Esc or tap outside to close. */
export class Viewer {
  readonly el: HTMLElement;
  private stage = h('div.viewer-stage');
  private caption = h('p.viewer-caption');
  private counter = h('span.viewer-count');
  private actions = h('div.viewer-actions');
  private prevBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private items: MediaItem[] = [];
  private index = 0;
  isOpen = false;
  actionsFor: (item: MediaItem) => ViewerAction[] = () => [];

  constructor(parent: HTMLElement) {
    this.prevBtn = h('button.icon-button.viewer-prev', { 'aria-label': 'Previous', onclick: () => this.step(-1) }, icon('left'));
    this.nextBtn = h('button.icon-button.viewer-next', { 'aria-label': 'Next', onclick: () => this.step(1) }, icon('right'));
    const close = h('button.icon-button.viewer-close', { 'aria-label': 'Close', onclick: () => this.close() }, icon('close'));
    this.el = h(
      'div.viewer',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Viewer', hidden: true },
      this.stage,
      this.prevBtn,
      this.nextBtn,
      close,
      h('footer.viewer-foot', {}, h('div', {}, this.caption, this.counter), this.actions),
    );
    parent.append(this.el);

    // tap on the backdrop (not the photo) closes
    this.stage.addEventListener('click', (e) => {
      if (e.target === this.stage) this.close();
    });
    this.attachSwipe();
  }

  open(items: MediaItem[], index: number): void {
    this.items = items;
    this.isOpen = true;
    this.el.hidden = false;
    this.show(index);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.hidden = true;
    this.stage.replaceChildren(); // stops video playback
  }

  get current(): MediaItem | undefined {
    return this.items[this.index];
  }

  /** Called when the store changes: drop deleted items, refresh the rest. */
  update(all: MediaItem[]): void {
    if (!this.isOpen) return;
    const byId = new Map(all.map((i) => [i.id, i]));
    const currentId = this.current?.id;
    this.items = this.items.map((i) => byId.get(i.id)).filter((i): i is MediaItem => !!i);
    if (!this.items.length) return this.close();
    const idx = this.items.findIndex((i) => i.id === currentId);
    if (idx === -1) this.show(Math.min(this.index, this.items.length - 1));
    else {
      this.index = idx;
      this.renderMeta();
    }
  }

  step(delta: number): void {
    if (this.items.length < 2) return;
    this.show((this.index + delta + this.items.length) % this.items.length);
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.isOpen) return false;
    if (e.key === 'Escape') this.close();
    else if (e.key === 'ArrowLeft') this.step(-1);
    else if (e.key === 'ArrowRight') this.step(1);
    else return false;
    return true;
  }

  private show(index: number) {
    this.index = index;
    const item = this.items[index]!;
    let media: HTMLElement;
    if (item.kind === 'video') {
      media = h('video.viewer-media', {
        src: item.displayUrl,
        poster: item.thumbUrl ?? undefined,
        controls: true,
        playsinline: true,
        preload: 'metadata',
      });
    } else {
      // Even when processing failed, the original may still display: Safari
      // shows HEIC natively. Fall back to the thumbnail, then to a message.
      const img = h('img.viewer-media', { src: item.status === 'processing' && item.thumbUrl ? item.thumbUrl : item.displayUrl, alt: item.name });
      img.onerror = () => {
        if (item.thumbUrl && img.src !== new URL(item.thumbUrl, location.href).href) img.src = item.thumbUrl;
        else if (this.current === item) this.showMissing(item);
      };
      media = img;
    }
    this.stage.replaceChildren(media);
    // quiet "..." until the full-size file arrives
    this.stage.classList.add('loading');
    const done = () => this.stage.classList.remove('loading');
    if (media instanceof HTMLImageElement) {
      if (media.complete) done();
      else media.addEventListener('load', done, { once: true }), media.addEventListener('error', done, { once: true });
    } else done(); // videos show their poster straight away (iOS won't preload)
    this.renderMeta();
    // preload neighbours
    for (const d of [1, -1]) {
      const n = this.items[(index + d + this.items.length) % this.items.length];
      if (n && n.kind === 'photo' && n !== item) new Image().src = n.displayUrl;
    }
  }

  private showMissing(item: MediaItem) {
    this.stage.classList.remove('loading');
    this.stage.replaceChildren(
      h(
        'div.viewer-missing',
        {},
        h('p', {}, "This file can't be shown in this browser. ", h('a', { href: `${item.originalUrl}?download` }, 'Download it')),
        item.error ? h('p.viewer-error', {}, item.error) : null,
      ),
    );
  }

  private renderMeta() {
    const item = this.items[this.index]!;
    const multi = this.items.length > 1;
    this.prevBtn.hidden = this.nextBtn.hidden = !multi;
    this.counter.textContent = multi ? `${this.index + 1}/${this.items.length}` : '';
    const date = formatDay(dayKey(item));
    const place = placeName([item]);
    this.caption.textContent = place ? `${date} · ${place}` : date;
    this.actions.replaceChildren(
      h('a.text-button', { href: `${item.originalUrl}?download`, download: item.name, title: 'Download original' }, icon('down'), 'save'),
      ...this.actionsFor(item).map((a) => this.actionButton(a, item)),
    );
  }

  private actionButton(a: ViewerAction, item: MediaItem): HTMLElement {
    const label = document.createTextNode(a.label);
    const btn = h(`button.text-button${a.danger ? '.danger' : ''}`, {}, icon(a.icon), label);
    let timer: number | undefined;
    btn.addEventListener('click', () => {
      if (a.confirm && !btn.classList.contains('armed')) {
        btn.classList.add('armed');
        label.textContent = a.confirm;
        timer = window.setTimeout(() => {
          btn.classList.remove('armed');
          label.textContent = a.label;
        }, 3000);
        return;
      }
      clearTimeout(timer);
      a.run(item);
    });
    return btn;
  }

  private attachSwipe() {
    let startX = 0;
    let startY = 0;
    let tracking = false;
    this.stage.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      tracking = true;
      startX = e.clientX;
      startY = e.clientY;
    });
    this.stage.addEventListener('pointerup', (e) => {
      if (!tracking) return;
      tracking = false;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) this.step(dx < 0 ? 1 : -1);
      else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) this.close(); // swipe down to dismiss
    });
    this.stage.addEventListener('pointercancel', () => (tracking = false));
  }
}
