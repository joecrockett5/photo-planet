import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

/** Where a photo was taken, in words. */
export interface Place {
  /** Town or city, e.g. "Osaka". Null out at sea, in the wilderness, etc. */
  city: string | null;
  /** Country name in English, e.g. "Japan". */
  country: string | null;
}

// server/geo, from both src/geo (tsx, vitest) and dist/geo (built).
const GEO_DIR = fileURLToPath(new URL('../../geo/', import.meta.url));
const CELL = 1; // degrees per grid cell of the spatial index
const SEARCH_KM = 25; // fallback: nearest town at most this far away
const EARTH_KM = 6371;
const DEG = Math.PI / 180;

/**
 * Each town "covers" a radius that grows with its size: ~2km for a village,
 * ~7km for Paris, ~15km for Tokyo, roughly the extent of the town proper.
 * Capitals (C) and regional capitals (A) get a floor, because a population
 * count understates spread-out ones like Lisbon.
 */
export function coverKm(population: number, rank = ''): number {
  const base = Math.max(2, 1.5 * Math.sqrt(population / 100_000));
  return rank === 'C' ? Math.max(base, 7) : rank === 'A' ? Math.max(base, 4) : base;
}

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });

/**
 * Offline reverse geocoding from bundled GeoNames towns (1,000+ people) and a
 * Natural Earth country raster.
 *
 * A point is named after the *largest* town that covers it, so a photo at the
 * Eiffel Tower is "Paris" rather than "Paris 07 Palais-Bourbon", and Tokyo
 * Tower is "Tokyo" rather than "Minato City", while Yokohama keeps its own
 * name. If no town covers it, the nearest town within 25km (weighted towards
 * bigger towns) is used; failing that, just the country.
 */
export class Places {
  private names: string[] = [];
  private lat = new Float32Array(0);
  private lon = new Float32Array(0);
  private pop = new Uint32Array(0);
  private cc: string[] = [];
  private cover = new Float32Array(0);
  private grid = new Map<number, number[]>();
  private countryMap: { width: number; height: number; data: Uint8Array } | null = null;
  private countryCodes: string[] = [];
  private cache = new Map<string, Place>();

  static load(dir = GEO_DIR): Places {
    const p = new Places();
    const lines = gunzipSync(readFileSync(`${dir}places.tsv.gz`)).toString('utf8').split('\n');
    const n = lines.length;
    p.lat = new Float32Array(n);
    p.lon = new Float32Array(n);
    p.pop = new Uint32Array(n);
    p.cover = new Float32Array(n);
    let i = 0;
    for (const line of lines) {
      const [name, lat, lon, pop, cc, rank] = line.split('\t');
      if (!name || !cc) continue;
      p.names.push(name);
      p.cc.push(cc);
      p.lat[i] = Number(lat);
      p.lon[i] = Number(lon);
      p.pop[i] = Number(pop);
      p.cover[i] = coverKm(Number(pop), rank);
      const key = cellKey(Math.floor(Number(lat) / CELL), Math.floor(Number(lon) / CELL));
      let bucket = p.grid.get(key);
      if (!bucket) p.grid.set(key, (bucket = []));
      bucket.push(i);
      i++;
    }
    p.countryMap = decodeRle(readFileSync(`${dir}countries.rle`));
    p.countryCodes = JSON.parse(readFileSync(`${dir}countries.json`, 'utf8')) as string[];
    return p;
  }

  lookup(lat: number, lon: number): Place {
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    let place = this.cache.get(key);
    if (!place) {
      place = this.compute(lat, lon);
      if (this.cache.size > 50_000) this.cache.clear();
      this.cache.set(key, place);
    }
    return place;
  }

  private compute(lat: number, lon: number): Place {
    let covering = -1; // largest town covering the point
    let nearby = -1; // best town within SEARCH_KM, by population / distance³
    let nearbyScore = 0;
    const cy = Math.floor(lat / CELL);
    const cx = Math.floor(lon / CELL);
    // enough cells east-west to span the search radius at this latitude
    const spanX = Math.min(180, Math.ceil(SEARCH_KM / (111 * Math.max(0.05, Math.cos(lat * DEG)) * CELL)) + 1);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -spanX; dx <= spanX; dx++) {
        const x = ((((cx + dx) % 360) + 540) % 360) - 180;
        const bucket = this.grid.get(cellKey(cy + dy, x));
        if (!bucket) continue;
        for (const i of bucket) {
          const d = distanceKm(lat, lon, this.lat[i]!, this.lon[i]!);
          const cover = this.cover[i]!;
          if (d > Math.max(SEARCH_KM, cover)) continue;
          if (d <= cover && (covering < 0 || this.pop[i]! > this.pop[covering]!)) covering = i;
          const score = this.pop[i]! / (d + 1) ** 3;
          if (d <= SEARCH_KM && score > nearbyScore) {
            nearby = i;
            nearbyScore = score;
          }
        }
      }
    }
    const town = covering >= 0 ? covering : nearby;
    const cc = town >= 0 ? this.cc[town]! : this.countryAt(lat, lon);
    return { city: town >= 0 ? this.names[town]! : null, country: cc ? countryName(cc) : null };
  }

  /** Country code at a point, looking a few texels around for coastal spots. */
  private countryAt(lat: number, lon: number): string | null {
    const map = this.countryMap;
    if (!map) return null;
    const { width: w, height: h, data } = map;
    const x0 = Math.floor(((lon + 180) / 360) * w);
    const y0 = Math.floor(((90 - lat) / 180) * h);
    for (let r = 0; r <= 4; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const y = y0 + dy;
          if (y < 0 || y >= h) continue;
          const id = data[y * w + ((((x0 + dx) % w) + w) % w)]!;
          if (id) return this.countryCodes[id] ?? null;
        }
      }
    }
    return null;
  }
}

function cellKey(y: number, x: number): number {
  return y * 1000 + x;
}

function countryName(cc: string): string {
  try {
    return countryNames.of(cc) ?? cc;
  } catch {
    return cc;
  }
}

/** Great-circle distance (haversine). */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The "PPE1" run-length format written by web/src/planet/earth-format.ts. */
function decodeRle(bytes: Uint8Array): { width: number; height: number; data: Uint8Array } {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x50 || bytes[2] !== 0x45 || bytes[3] !== 0x31) throw new Error('bad map');
  const width = bytes[4]! | (bytes[5]! << 8);
  const height = bytes[6]! | (bytes[7]! << 8);
  const data = new Uint8Array(width * height);
  let o = 0;
  for (let i = 8; i + 1 < bytes.length; i += 2) {
    const end = o + bytes[i + 1]! + 1;
    data.fill(bytes[i]!, o, end);
    o = end;
  }
  return { width, height, data };
}
