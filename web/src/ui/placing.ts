import { api, type MediaItem, type PlaceMatch } from '../api';
import { h } from './dom';
import { icon } from './icons';

/**
 * Placement mode for one or more items: tap the planet, or type a town and
 * pick a suggestion. Moving through suggestions previews them on the planet.
 */
export class Placing {
  private el: HTMLElement;
  private thumbs = h('span.placing-thumbs');
  private heading = h('span.placing-text');
  private input: HTMLInputElement;
  private list = h('ul.placing-suggestions', { role: 'listbox', id: 'placing-suggestions', hidden: true });
  private matches: PlaceMatch[] = [];
  private highlighted = -1;
  private searchTimer: number | undefined;
  private searchAbort: AbortController | null = null;
  items: MediaItem[] = [];
  onChange: ((items: MediaItem[] | null) => void) | null = null;
  /** A suggestion is highlighted (preview it), or none is (null). */
  onPreview: ((match: PlaceMatch | null) => void) | null = null;
  onChoose: ((match: PlaceMatch) => void) | null = null;
  /** The panel changed size (suggestions came and went). */
  onResize: ((bottom: number) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.input = h('input.placing-input', {
      type: 'search',
      placeholder: 'or type a town…',
      'aria-label': 'Search for a town or city',
      autocomplete: 'off',
      autocapitalize: 'words',
      spellcheck: 'false',
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-controls': 'placing-suggestions',
      'aria-expanded': 'false',
    });
    this.input.addEventListener('input', () => this.queueSearch());
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.el = h(
      'div.placing',
      { hidden: true },
      h(
        'div.placing-head',
        {},
        this.thumbs,
        this.heading,
        h('button.icon-button.placing-cancel', { 'aria-label': 'Cancel', onclick: () => this.cancel() }, icon('close')),
      ),
      h('div.placing-search', {}, this.input),
      this.list,
    );
    parent.append(this.el);
    new ResizeObserver(() => {
      if (this.active) this.onResize?.(this.el.getBoundingClientRect().bottom);
    }).observe(this.el);
  }

  start(items: MediaItem[]): void {
    this.items = items;
    const shown = items.slice(0, 3);
    this.thumbs.replaceChildren(
      ...shown.map((i) => h('span.placing-thumb', {}, i.thumbUrl ? h('img', { src: i.thumbUrl, alt: '' }) : '')),
      ...(items.length > 3 ? [h('span.placing-more', {}, `+${items.length - 3}`)] : []),
    );
    this.heading.textContent =
      items.length === 1 ? 'Tap the planet where this was taken' : `Tap the planet where these ${items.length} were taken`;
    this.input.value = '';
    this.setMatches([]);
    this.el.hidden = false;
    document.body.classList.add('placing-mode');
    this.onChange?.(items);
  }

  cancel(): void {
    if (!this.items.length) return;
    this.items = [];
    clearTimeout(this.searchTimer);
    this.searchAbort?.abort();
    this.el.hidden = true;
    this.input.blur();
    document.body.classList.remove('placing-mode');
    this.onChange?.(null);
  }

  get active(): boolean {
    return this.items.length > 0;
  }

  private queueSearch() {
    clearTimeout(this.searchTimer);
    const q = this.input.value.trim();
    if (!q) {
      this.searchAbort?.abort();
      return this.setMatches([]);
    }
    this.searchTimer = window.setTimeout(() => void this.search(q), 120);
  }

  private async search(q: string) {
    this.searchAbort?.abort();
    const abort = (this.searchAbort = new AbortController());
    try {
      const matches = await api.searchPlaces(q, abort.signal);
      if (!abort.signal.aborted) this.setMatches(matches);
    } catch {
      // aborted by newer typing, or offline: keep what's shown
    }
  }

  private setMatches(matches: PlaceMatch[]) {
    this.matches = matches;
    this.highlighted = -1;
    const typed = this.input.value.trim();
    this.list.replaceChildren(
      ...matches.map((m, i) =>
        h(
          'li',
          { role: 'option', id: `placing-option-${i}` },
          h(
            'button.placing-option',
            {
              type: 'button',
              tabindex: '-1',
              // keep focus in the input on desktop; choose on click/tap
              onmousedown: (e: Event) => e.preventDefault(),
              onmouseenter: () => this.highlight(i),
              onclick: () => this.choose(i),
            },
            h('span.placing-name', {}, m.name),
            h('span.placing-country', {}, m.country),
          ),
        ),
      ),
      ...(typed && !matches.length ? [h('li.placing-none', {}, 'No town by that name')] : []),
    );
    this.list.hidden = !typed;
    this.input.setAttribute('aria-expanded', String(matches.length > 0));
    this.onPreview?.(null);
  }

  private highlight(i: number) {
    if (i === this.highlighted) return;
    this.highlighted = i;
    [...this.list.querySelectorAll('.placing-option')].forEach((el, j) => el.classList.toggle('active', j === i));
    this.input.setAttribute('aria-activedescendant', i >= 0 ? `placing-option-${i}` : '');
    this.onPreview?.(this.matches[i] ?? null);
  }

  private choose(i: number) {
    const match = this.matches[i];
    if (match) this.onChoose?.(match);
  }

  private onKey(e: KeyboardEvent) {
    // keep arrow keys and Esc away from the planet/global handlers
    e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!this.matches.length) return;
      const n = this.matches.length;
      this.highlight(e.key === 'ArrowDown' ? (this.highlighted + 1) % n : (this.highlighted - 1 + n) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.choose(Math.max(0, this.highlighted));
    } else if (e.key === 'Escape') {
      if (this.input.value) {
        this.input.value = '';
        this.setMatches([]);
      } else {
        this.cancel();
      }
    }
  }
}
