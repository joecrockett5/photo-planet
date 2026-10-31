import type { MediaItem } from '../api';
import { countryAt } from '../planet/earth';

/** "Portugal", "Portugal & Spain", "3 countries", or "" for open sea. */
export async function placeName(items: Pick<MediaItem, 'lat' | 'lon'>[]): Promise<string> {
  const names = await Promise.all(
    items.filter((i) => i.lat !== null && i.lon !== null).map((i) => countryAt(i.lat!, i.lon!)),
  );
  const unique = [...new Set(names.filter((n): n is string => !!n))];
  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0]!;
  if (unique.length === 2) return `${unique[0]} & ${unique[1]}`;
  return `${unique.length} countries`;
}
