import biomesUrl from './earth-biomes.bin?url';
import countriesUrl from './earth-countries.bin?url';
import { decodeRle } from './earth-format';

export interface EarthMap {
  width: number;
  height: number;
  data: Uint8Array;
}

async function load(url: string): Promise<EarthMap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load ${url}`);
  return decodeRle(new Uint8Array(await res.arrayBuffer()));
}

export const loadBiomes = () => load(biomesUrl);

let countryLookup: Promise<(lat: number, lon: number) => string | null> | null = null;

/**
 * Offline reverse geocoding to country level, from a bundled raster. Looks a
 * few texels around the point so coastal photos still find their country.
 */
export function countryAt(lat: number, lon: number): Promise<string | null> {
  countryLookup ??= Promise.all([load(countriesUrl), import('./countries.json').then((m) => m.default as string[])]).then(
    ([map, names]) =>
      (la: number, lo: number) => {
        const { width: w, height: h, data } = map;
        const x0 = Math.floor(((lo + 180) / 360) * w);
        const y0 = Math.floor(((90 - la) / 180) * h);
        for (let r = 0; r <= 6; r++) {
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
              const y = y0 + dy;
              if (y < 0 || y >= h) continue;
              const id = data[y * w + ((((x0 + dx) % w) + w) % w)]!;
              if (id) return names[id] ?? null;
            }
          }
        }
        return null;
      },
  );
  return countryLookup.then((f) => f(lat, lon));
}
