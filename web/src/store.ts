import { api, type MediaItem } from './api';

type Listener = (items: MediaItem[]) => void;

/** The media list, refreshed from the server; polls while anything is processing. */
class Store {
  items: MediaItem[] = [];
  loaded = false;
  private listeners = new Set<Listener>();
  private pollTimer: number | undefined;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    if (this.loaded) fn(this.items);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.items);
    clearTimeout(this.pollTimer);
    if (this.items.some((i) => i.status === 'processing')) {
      this.pollTimer = window.setTimeout(() => void this.refresh(), 2000);
    }
  }

  async refresh(): Promise<void> {
    this.items = await api.list();
    this.loaded = true;
    this.emit();
  }

  /** Insert or replace items locally (e.g. right after an upload or edit). */
  upsert(...items: MediaItem[]): void {
    const byId = new Map(this.items.map((i) => [i.id, i]));
    for (const item of items) byId.set(item.id, item);
    this.items = [...byId.values()];
    this.emit();
  }

  remove(id: string): void {
    this.items = this.items.filter((i) => i.id !== id);
    this.emit();
  }

  get(id: string): MediaItem | undefined {
    return this.items.find((i) => i.id === id);
  }

  get placed(): (MediaItem & { lat: number; lon: number })[] {
    return this.items.filter((i): i is MediaItem & { lat: number; lon: number } => i.lat !== null && i.lon !== null);
  }

  get unplaced(): MediaItem[] {
    return this.items.filter((i) => i.lat === null || i.lon === null);
  }
}

export const store = new Store();
