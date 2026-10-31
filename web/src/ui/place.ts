import type { MediaItem } from '../api';

type Placed = Pick<MediaItem, 'place'>;

/** Distinct values, most common first (ties alphabetical). */
function ranked(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
}

function list(names: string[]): string {
  if (names.length === 1) return names[0]!;
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
  return `${names[0]}, ${names[1]} & ${names.length - 2} more`;
}

/**
 * Words for where some items were taken (place names come from the server):
 *   full:  "Osaka, Japan" · "Tokyo & Osaka, Japan" · "Japan & South Korea"
 *   short: "Osaka" · "Tokyo & Osaka" (for small labels on the map)
 * Empty string when nothing is known (e.g. open sea).
 */
export function placeName(items: Placed[], style: 'full' | 'short' = 'full'): string {
  const places = items.map((i) => i.place).filter((p): p is NonNullable<MediaItem['place']> => !!p);
  const countries = ranked(places.map((p) => p.country).filter((c): c is string => !!c));
  const cities = ranked(places.map((p) => p.city).filter((c): c is string => !!c));
  if (countries.length > 1) {
    return countries.length === 2 ? `${countries[0]} & ${countries[1]}` : `${countries.length} countries`;
  }
  const country = countries[0];
  if (!cities.length) return country ?? '';
  const where = list(cities);
  return style === 'short' || !country ? where : `${where}, ${country}`;
}
