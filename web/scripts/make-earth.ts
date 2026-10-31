/**
 * Rasterise Natural Earth geography (from the `world-atlas` package) into the
 * small equirectangular maps the planet renderer samples:
 *   - earth-biomes.bin: a biome index per texel (ocean depth, beach, grass,
 *     forest, desert, rock/tundra, ice). Land/ocean is real data; biomes are
 *     hand-placed regions with noisy edges, which is plenty at pixel-art scale.
 *   - earth-countries.bin + countries.json: a country index per texel, for
 *     offline "where is this" labels.
 * Run with `npm run earth -w web`. Outputs are committed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';
import { fbm } from '../src/render/noise';
import { BIOME, encodeRle } from '../src/planet/earth-format';

const require = createRequire(import.meta.url);
const W = 2048;
const H = 1024;
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/planet');

type Ring = [number, number][];
type Polygon = Ring[];

function polygonsOf(geom: { type: string; coordinates: unknown }): Polygon[] {
  if (geom.type === 'Polygon') return [geom.coordinates as Polygon];
  if (geom.type === 'MultiPolygon') return geom.coordinates as Polygon[];
  return [];
}

/**
 * Rings that cross the antimeridian (lon jumps by ~360) are unwrapped into a
 * continuous ring and filled three times, shifted by -360/0/+360. Rings that
 * run along a pole edge (Antarctica) are already closed in plain lon/lat.
 */
function fillPolygon(grid: Uint8Array, poly: Polygon, value: number) {
  const touchesPole = poly.some((ring) => ring.some(([, lat]) => Math.abs(lat) > 89.9));
  const wraps = poly.some((ring) => ring.some(([lon], i) => i > 0 && Math.abs(lon - ring[i - 1]![0]) > 180));
  if (!wraps || touchesPole) return fillPlanar(grid, poly, value);
  const unwrapped = poly.map((ring) => {
    const out: Ring = [];
    let offset = 0;
    ring.forEach(([lon, lat], i) => {
      if (i > 0) {
        const prev = ring[i - 1]![0];
        if (lon - prev > 180) offset -= 360;
        else if (prev - lon > 180) offset += 360;
      }
      out.push([lon + offset, lat]);
    });
    return out;
  });
  for (const shift of [-360, 0, 360]) fillPlanar(grid, unwrapped.map((r) => r.map(([x, y]) => [x + shift, y] as [number, number])), value);
}

/** Even-odd scanline fill of one polygon (outer ring + holes) at texel centres. */
function fillPlanar(grid: Uint8Array, poly: Polygon, value: number) {
  let minY = H;
  let maxY = 0;
  for (const ring of poly)
    for (const [, lat] of ring) {
      const y = (90 - lat) / 180 * H;
      minY = Math.min(minY, Math.floor(y));
      maxY = Math.max(maxY, Math.ceil(y));
    }
  for (let y = Math.max(0, minY); y <= Math.min(H - 1, maxY); y++) {
    const lat = 90 - ((y + 0.5) / H) * 180;
    const xs: number[] = [];
    for (const ring of poly) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x1, y1] = ring[j]!;
        const [x2, y2] = ring[i]!;
        if (y1 > lat !== y2 > lat) xs.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.ceil(((xs[k]! + 180) / 360) * W - 0.5);
      const b = Math.floor(((xs[k + 1]! + 180) / 360) * W - 0.5);
      for (let x = Math.max(0, a); x <= Math.min(W - 1, b); x++) grid[y * W + x] = value;
    }
  }
}

/**
 * Approximate distance (in texels) to the nearest texel where `isSource`,
 * wrapping east-west. Alternating 4- and 8-neighbour steps gives octagonal
 * rather than square halos around small islands.
 */
function distanceTo(isSource: (i: number) => boolean, max: number): Uint8Array {
  const dist = new Uint8Array(W * H).fill(255);
  let frontier: number[] = [];
  for (let i = 0; i < W * H; i++) if (isSource(i)) (dist[i] = 0), frontier.push(i);
  for (let d = 1; d <= max && frontier.length; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % W;
      const y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (d % 2 === 1 && dx !== 0 && dy !== 0) continue;
          const j = ny * W + ((x + dx + W) % W);
          if (dist[j] === 255) (dist[j] = d), next.push(j);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

// ---------------------------------------------------------------- land + countries

const land = new Uint8Array(W * H);
const landTopo = JSON.parse(readFileSync(require.resolve('world-atlas/land-50m.json'), 'utf8'));
for (const f of (feature(landTopo, landTopo.objects.land) as unknown as { features: { geometry: never }[] }).features)
  for (const poly of polygonsOf(f.geometry)) fillPolygon(land, poly, 1);

const countryTopo = JSON.parse(readFileSync(require.resolve('world-atlas/countries-50m.json'), 'utf8'));
const countryFeatures = (
  feature(countryTopo, countryTopo.objects.countries) as unknown as {
    features: { properties: { name: string }; geometry: never }[];
  }
).features;
if (countryFeatures.length > 254) throw new Error('too many countries for a byte');
const countries = new Uint8Array(W * H);
const names: string[] = [''];
for (const f of countryFeatures) {
  names.push(f.properties.name);
  for (const poly of polygonsOf(f.geometry)) fillPolygon(countries, poly, names.length - 1);
}

// ---------------------------------------------------------------- biomes

/** Soft elliptical region with a noisy edge; > 0 inside. */
function region(lat: number, lon: number, cLat: number, cLon: number, rLat: number, rLon: number, wobble = 0.5) {
  const d = Math.hypot((lat - cLat) / rLat, (lon - cLon) / rLon);
  return 1 - d + (fbm(lon / 5, lat / 5, 4, 7) - 0.5) * wobble * 2;
}

const DESERTS: [number, number, number, number][] = [
  [23, 8, 9.5, 27], // Sahara
  [17, -4, 5, 14], // western Sahara/Sahel edge
  [23, 47, 9, 13], // Arabia
  [29, 61, 6, 11], // Iran / Pakistan
  [27, 71, 3.5, 4], // Thar
  [42, 61, 4.5, 8], // Karakum / Kyzylkum
  [40, 84, 3.5, 9], // Taklamakan
  [43, 104, 4.5, 13], // Gobi
  [-25, 131, 7.5, 13], // Australian interior
  [32, -113, 5.5, 7], // Sonoran / Mojave
  [28, -104, 4, 4], // Chihuahuan
  [-22, -69.5, 7, 1.7], // Atacama
  [-24, 19, 5, 7], // Kalahari / Namib
  [8, 46, 4, 5], // Horn of Africa
  [-45, -68, 6, 3.5], // Patagonian steppe
];
const FORESTS: [number, number, number, number][] = [
  [-5, -62, 11, 15], // Amazon
  [0, 20, 6, 10], // Congo
  [3, 108, 9, 22], // Maritime SE Asia
  [18, 100, 7, 7], // Indochina
  [12, -85, 6, 6], // Central America
  [-18, 147, 4, 3], // Queensland
  [-42, 172, 5, 4], // New Zealand
  [24, 92, 3, 5], // NE India / Bangladesh
  [-20, 47, 5, 2], // Madagascar east
  [6, -8, 3.5, 7], // West African coast
];

const greenlandId = names.indexOf('Greenland');
if (greenlandId < 1) throw new Error('Greenland not found');

// Westernmost land texel per row in South America, to hug the Andes to the Pacific coast.
const andesWestLon = new Float32Array(H).fill(NaN);
for (let y = 0; y < H; y++) {
  const lat = 90 - ((y + 0.5) / H) * 180;
  if (lat > 11 || lat < -55) continue;
  for (let x = Math.floor(((-82 + 180) / 360) * W); x < Math.floor(((-60 + 180) / 360) * W); x++) {
    if (land[y * W + x]) {
      andesWestLon[y] = ((x + 0.5) / W) * 360 - 180;
      break;
    }
  }
}

function biomeFor(lat: number, lon: number, coast: number, i: number): number {
  const y = (i / W) | 0;
  const n = fbm(lon / 3.1, lat / 3.1, 4, 99);
  const alat = Math.abs(lat);
  // ice caps: Antarctica, Greenland's interior, the high Arctic
  if (lat < -61) return BIOME.ice;
  if (countries[i] === greenlandId && coast > 2 + n * 4) return BIOME.ice;
  if (lat > 78 + n * 3) return BIOME.ice;
  // tundra / bare rock in the far north and on the Tibetan plateau
  if (lat > 66 + n * 5) return BIOME.rock;
  if (region(lat, lon, 33, 88, 5, 11, 0.35) > 0) return n > 0.62 ? BIOME.ice : BIOME.rock;
  // Andes: a band inland from the Pacific coast, widest at the Altiplano.
  const west = andesWestLon[y]!;
  if (!Number.isNaN(west) && lon < -62) {
    const width = 2.2 + 3.5 * Math.exp(-(((lat + 18) / 7) ** 2)) + (n - 0.5) * 2;
    const inland = lon - west;
    if (inland > 0.4 && inland < width) return n > 0.66 && lat < -28 ? BIOME.ice : BIOME.rock;
  }
  // Rockies, loosely
  if (lat > 34 && lat < 61) {
    const axis = -106 - (lat - 37) * 0.8; // runs NW-SE
    if (Math.abs(lon - axis) < 2.2 + (n - 0.5) * 5 && n > 0.46) return BIOME.rock;
  }
  for (const [a, b, c, d] of DESERTS) if (region(lat, lon, a, b, c, d) > 0) return BIOME.desert;
  // sandy coasts in warm latitudes
  if (coast <= 2 && alat < 38 && n > 0.45) return BIOME.beach;
  for (const [a, b, c, d] of FORESTS) if (region(lat, lon, a, b, c, d) > 0) return BIOME.forest;
  // boreal forest belt, and patchy temperate forest
  if (lat > 46 + n * 7 && lat < 64 + n * 3 && n > 0.38) return BIOME.forest;
  if (alat > 34 + n * 8 && alat < 58 && n > 0.56) return BIOME.forest;
  return BIOME.grass;
}

const landDist = distanceTo((i) => land[i] === 0, 8); // land texels: distance to sea
const seaDist = distanceTo((i) => land[i] === 1, 12); // sea texels: distance to land
const biomes = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  const lat = 90 - ((y + 0.5) / H) * 180;
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const lon = ((x + 0.5) / W) * 360 - 180;
    if (land[i]) {
      biomes[i] = biomeFor(lat, lon, landDist[i]!, i);
    } else if (lat > 79 + fbm(lon / 4, lat / 4, 3, 5) * 6 || lat < -73) {
      biomes[i] = BIOME.ice; // sea ice
    } else {
      const n = fbm(lon / 2.3, lat / 2.3, 3, 11);
      biomes[i] = seaDist[i]! <= 4 + n * 7 ? BIOME.shallow : BIOME.deep;
    }
  }
}

// ---------------------------------------------------------------- write

const biomeBin = encodeRle(biomes, W, H);
const countryBin = encodeRle(countries, W, H);
writeFileSync(path.join(outDir, 'earth-biomes.bin'), biomeBin);
writeFileSync(path.join(outDir, 'earth-countries.bin'), countryBin);
writeFileSync(path.join(outDir, 'countries.json'), JSON.stringify(names));
console.log(`biomes ${(biomeBin.length / 1024).toFixed(0)}KB, countries ${(countryBin.length / 1024).toFixed(0)}KB`);

// Optional preview: PREVIEW=out.png (uses sharp from the server workspace).
if (process.env.PREVIEW) {
  const sharp = require('sharp');
  const colors = ['#1c4087', '#2b78bb', '#e3d29a', '#62ad4f', '#28704a', '#e0bf78', '#8e8476', '#f1f5ff'];
  const rgb = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    const c = parseInt(colors[biomes[i]!]!.slice(1), 16);
    rgb[i * 3] = c >> 16;
    rgb[i * 3 + 1] = (c >> 8) & 255;
    rgb[i * 3 + 2] = c & 255;
  }
  await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).png().toFile(process.env.PREVIEW);
}
