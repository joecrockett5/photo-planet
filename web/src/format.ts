import type { MediaItem } from './api';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The calendar date an item was taken, as the wall-clock date where it was
 * taken: read straight from the stored string so timezones don't shift it.
 */
export function dayKey(item: MediaItem): string | null {
  const m = item.takenAt && /^(\d{4})-(\d{2})-(\d{2})/.exec(item.takenAt);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function formatDay(key: string | null): string {
  if (!key) return 'Undated';
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function formatDuration(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds)) return '';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Sort key: capture time, undated last, then upload time. */
export function byDate(a: MediaItem, b: MediaItem): number {
  if (a.takenAt && b.takenAt) return a.takenAt < b.takenAt ? -1 : a.takenAt > b.takenAt ? 1 : 0;
  if (a.takenAt) return -1;
  if (b.takenAt) return 1;
  return a.uploadedAt < b.uploadedAt ? -1 : 1;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function describeItems(items: MediaItem[]): string {
  const photos = items.filter((i) => i.kind === 'photo').length;
  const videos = items.length - photos;
  if (!videos) return plural(photos, 'photo');
  if (!photos) return plural(videos, 'video');
  return `${plural(photos, 'photo')}, ${plural(videos, 'video')}`;
}
