import type { MediaItem } from '../api';
import { byDate, byUploadNewest, dayKey, describeItems, formatDay, formatDuration, formatUploadDay, plural, uploadDayKey } from '../format';
import { h } from './dom';
import { icon } from './icons';
import { placeName } from './place';

type Mode = 'place' | 'tray' | 'feed';
/** The feed renders this many thumbnails at a time ("show more" for the rest). */
const FEED_PAGE = 240;

/**
 * A panel of thumbnails: a side panel on wide screens, a bottom sheet on
 * phones. Three uses:
 *  - place: the items at one pin, grouped by the day they were taken
 *  - tray:  everything without a location (live), with select/place/delete
 *  - feed:  every upload, newest first, grouped by the day it was uploaded (live)
 */
export class Gallery {
  readonly el: HTMLElement;
  private title = h('h2.gallery-title');
  private sub = h('p.gallery-sub');
  private grid = h('div.gallery-grid');
  private ids: string[] = [];
  private items: MediaItem[] = [];
  isOpen = false;
  onClose: (() => void) | null = null;
  onOpenItem: ((items: MediaItem[], index: number) => void) | null = null;
  /** Tray: place the selected items. */
  onPlace: ((items: MediaItem[]) => void) | null = null;
  /** Tray: delete the selected items (after a confirming second tap). */
  onDelete: ((items: MediaItem[]) => void) | null = null;
  private deleteButton: HTMLButtonElement;
  private deleteLabel = document.createTextNode('delete');
  private deleteTimer: number | undefined;
  /** Tray select mode: ids of the chosen items, or null when not selecting. */
  private selected: Set<string> | null = null;
  private selectButton: HTMLButtonElement;
  private actions = h('div.gallery-actions', { hidden: true });
  private selectedCount = h('span.gallery-count');
  private placeButton: HTMLButtonElement;
  private allButton: HTMLButtonElement;
  /** Which items belong here, given the full list (for live updates). */
  private keep: (item: MediaItem) => boolean = (i) => i.lat !== null;
  private mode: Mode = 'place';
  /** Tray and feed show every item matching `keep` (live), not a fixed set. */
  private get live(): boolean {
    return this.mode !== 'place';
  }
  private feedLimit = FEED_PAGE;

  constructor(parent: HTMLElement) {
    const close = h('button.icon-button.gallery-close', { 'aria-label': 'Close', onclick: () => this.close() }, icon('close'));
    this.selectButton = h('button.text-button.gallery-select', { hidden: true, onclick: () => this.toggleSelecting() }, 'select');
    this.allButton = h('button.text-button', { onclick: () => this.selectAll() }, 'all');
    this.placeButton = h(
      'button.text-button.gallery-place',
      { onclick: () => this.placeSelected() },
      icon('pin'),
      'place',
    );
    this.deleteButton = h('button.text-button.danger.gallery-delete', { onclick: () => this.deleteSelected() }, icon('trash'), this.deleteLabel);
    this.actions.append(
      this.selectedCount,
      h('span.gallery-actions-buttons', {}, this.allButton, this.deleteButton, this.placeButton),
    );
    this.el = h(
      'aside.gallery',
      { 'aria-label': 'Photos here', hidden: true },
      h('header.gallery-head', {}, h('div', {}, this.title, this.sub), h('div.gallery-head-buttons', {}, this.selectButton, close)),
      this.grid,
      this.actions,
    );
    parent.append(this.el);
  }

  /** The items at a place. */
  open(items: MediaItem[]): void {
    this.keep = (i) => i.lat !== null;
    this.mode = 'place';
    this.show(items);
    this.title.textContent = placeName(items) || 'Somewhere';
  }

  /** The unplaced tray: everything without a location. */
  openTray(all: MediaItem[]): void {
    this.keep = (i) => i.lat === null;
    this.mode = 'tray';
    this.title.textContent = 'Unplaced';
    this.show(all.filter(this.keep));
  }

  /** The uploads feed: everything, newest upload first. */
  openFeed(all: MediaItem[]): void {
    this.keep = () => true;
    this.mode = 'feed';
    this.feedLimit = FEED_PAGE;
    this.title.textContent = 'Uploads';
    this.show(all);
  }

  get isTray(): boolean {
    return this.isOpen && this.mode === 'tray';
  }

  get isFeed(): boolean {
    return this.isOpen && this.mode === 'feed';
  }

  private show(items: MediaItem[]) {
    this.selected = null;
    this.selectButton.hidden = this.mode !== 'tray';
    this.ids = items.map((i) => i.id);
    this.isOpen = true;
    this.el.hidden = false;
    this.el.classList.toggle('tray', this.mode === 'tray');
    this.el.setAttribute('aria-label', this.mode === 'feed' ? 'Uploads' : this.mode === 'tray' ? 'Unplaced' : 'Photos here');
    this.render(items);
    this.grid.scrollTop = 0;
    requestAnimationFrame(() => this.el.classList.add('open'));
  }

  /** Keep in sync with the store: drop deleted or moved-away items, refresh statuses. */
  update(all: MediaItem[]): void {
    if (!this.isOpen) return;
    const byId = new Map(all.map((i) => [i.id, i]));
    const items = this.live
      ? all.filter(this.keep)
      : this.ids.map((id) => byId.get(id)).filter((i): i is MediaItem => !!i && this.keep(i));
    this.ids = items.map((i) => i.id);
    if (!items.length && this.mode !== 'feed') return this.close();
    if (this.selected) for (const id of [...this.selected]) if (!this.ids.includes(id)) this.selected.delete(id);
    this.render(items);
  }

  // ---------------------------------------------------------------- tray selection

  private toggleSelecting() {
    this.selected = this.selected ? null : new Set();
    this.render(this.items);
  }

  private selectAll() {
    if (!this.selected) return;
    const all = this.selected.size === this.items.length;
    this.selected = new Set(all ? [] : this.items.map((i) => i.id));
    this.render(this.items);
  }

  private placeSelected() {
    if (!this.selected?.size) return;
    const chosen = this.items.filter((i) => this.selected!.has(i.id));
    this.onPlace?.(chosen);
  }

  /** First tap arms ("delete 3?"), a second within 3s deletes. */
  private deleteSelected() {
    if (!this.selected?.size) return;
    if (!this.deleteButton.classList.contains('armed')) {
      this.deleteButton.classList.add('armed');
      this.deleteLabel.textContent = `delete ${this.selected.size}?`;
      this.deleteTimer = window.setTimeout(() => this.disarmDelete(), 3000);
      return;
    }
    this.disarmDelete();
    const chosen = this.items.filter((i) => this.selected!.has(i.id));
    this.onDelete?.(chosen);
  }

  private disarmDelete() {
    clearTimeout(this.deleteTimer);
    this.deleteButton.classList.remove('armed');
    this.deleteLabel.textContent = 'delete';
  }

  private renderSelection() {
    this.disarmDelete(); // the selection changed: ask again
    const selecting = this.selected !== null;
    const n = this.selected?.size ?? 0;
    this.el.classList.toggle('selecting', selecting);
    this.selectButton.textContent = selecting ? 'done' : 'select';
    this.actions.hidden = !selecting;
    this.selectedCount.textContent = n ? `${n} selected` : 'Tap photos to choose';
    this.allButton.textContent = n === this.items.length && n > 0 ? 'none' : 'all';
    this.placeButton.disabled = n === 0;
    this.deleteButton.disabled = n === 0;
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.selected = null;
    this.el.classList.remove('open');
    this.el.hidden = true;
    this.onClose?.();
  }

  private render(items: MediaItem[]) {
    if (this.mode === 'feed') return this.renderFeed(items);
    this.items = [...items].sort(byDate);
    this.sub.textContent = this.live
      ? `${describeItems(this.items)} without a location. Open one to place it, or select several`
      : describeItems(this.items);
    const groups = new Map<string | null, MediaItem[]>();
    for (const item of this.items) {
      const key = dayKey(item);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    // When a pin covers several towns, say which town each day was in.
    const manyTowns = !this.live && new Set(this.items.map((i) => i.place?.city ?? '')).size > 1;
    const frag = document.createDocumentFragment();
    for (const [day, dayItems] of groups) {
      const town = manyTowns ? placeName(dayItems, 'short') : '';
      frag.append(h('h3.gallery-day', {}, town ? `${formatDay(day)} · ${town}` : formatDay(day)));
      const row = h('div.gallery-thumbs');
      for (const item of dayItems) row.append(this.thumb(item));
      frag.append(row);
    }
    this.grid.replaceChildren(frag);
    this.renderSelection();
  }

  /** Every upload, newest first, under the (local) day it was uploaded. */
  private renderFeed(items: MediaItem[]) {
    this.items = [...items].sort(byUploadNewest);
    this.sub.textContent = this.items.length ? `${describeItems(this.items)} · newest first` : '';
    const shown = this.items.slice(0, this.feedLimit);
    const groups = new Map<string, MediaItem[]>();
    for (const item of shown) {
      const key = uploadDayKey(item);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    // the day's full count, even if only some of it is shown so far
    const totals = new Map<string, number>();
    for (const item of this.items) totals.set(uploadDayKey(item), (totals.get(uploadDayKey(item)) ?? 0) + 1);
    const frag = document.createDocumentFragment();
    if (!this.items.length) frag.append(h('p.gallery-empty', {}, 'Nothing uploaded yet. Tap + to add photos'));
    for (const [day, dayItems] of groups) {
      frag.append(h('h3.gallery-day', {}, `${formatUploadDay(day)} · ${plural(totals.get(day) ?? dayItems.length, 'upload')}`));
      const row = h('div.gallery-thumbs');
      for (const item of dayItems) row.append(this.thumb(item));
      frag.append(row);
    }
    if (this.items.length > shown.length) {
      frag.append(
        h(
          'button.text-button.gallery-more',
          {
            onclick: () => {
              this.feedLimit += FEED_PAGE;
              this.render(this.items);
            },
          },
          `show more (${this.items.length - shown.length} older)`,
        ),
      );
    }
    this.grid.replaceChildren(frag);
    this.renderSelection();
  }

  private thumb(item: MediaItem): HTMLElement {
    const index = this.items.indexOf(item);
    const label = `${item.kind === 'video' ? 'Video' : 'Photo'} ${item.name}`;
    const selected = this.selected?.has(item.id) ?? false;
    const btn = h(`button.thumb${selected ? '.selected' : ''}`, {
      'aria-label': label,
      'aria-pressed': this.selected ? String(selected) : undefined,
      onclick: () => {
        if (!this.selected) return this.onOpenItem?.(this.items, index);
        if (this.selected.has(item.id)) this.selected.delete(item.id);
        else this.selected.add(item.id);
        btn.classList.toggle('selected');
        btn.setAttribute('aria-pressed', String(this.selected.has(item.id)));
        this.renderSelection();
      },
    });
    if (item.thumbUrl) {
      btn.append(h('img', { src: item.thumbUrl, alt: '', loading: 'lazy', decoding: 'async' }));
    } else {
      btn.append(h('span.thumb-empty', {}, item.status === 'processing' ? '...' : '?'));
    }
    if (item.kind === 'video') btn.append(h('span.thumb-badge', {}, icon('play'), formatDuration(item.duration)));
    if (this.selected) btn.append(h('span.thumb-check', {}, icon('check')));
    return btn;
  }
}
