/**
 * Build the offline place-name data the server uses to say "Osaka, Japan":
 *   - geo/places.tsv.gz: towns and cities from GeoNames `cities1000` (places
 *     with 1,000+ people, plus seats of local government): name, lat, lon,
 *     population, country code, and C/A for national/regional capitals.
 *   - geo/countries.rle + geo/countries.json: a 2048x1024 country raster
 *     (ISO alpha-2 codes) from Natural Earth via world-atlas, for photos that
 *     aren't near any town (sea, mountains, desert).
 *
 * Inputs aren't committed; fetch them first (GeoNames data is CC BY 4.0):
 *   mkdir -p /tmp/geonames && cd /tmp/geonames
 *   curl -O https://download.geonames.org/export/dump/cities1000.zip && unzip cities1000.zip
 *   curl -O https://download.geonames.org/export/dump/countryInfo.txt
 * then: npm run places -w server -- /tmp/geonames
 * Outputs are committed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { feature } from 'topojson-client';
import { encodeRle } from '../../web/src/planet/earth-format';
import { fillPolygon, polygonsOf } from '../../web/scripts/raster';

const require = createRequire(import.meta.url);
const src = process.argv[2];
if (!src) throw new Error('usage: make-places <dir with cities1000.txt and countryInfo.txt>');
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '../geo');

// Sections of a city (PPLX: "Paris 10e Arrondissement", "Shibuya"), historical,
// abandoned or destroyed places: a photo should be labelled with the real town.
const SKIP = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH']);

// ---------------------------------------------------------------- towns

const rows: string[] = [];
for (const line of readFileSync(path.join(src, 'cities1000.txt'), 'utf8').split('\n')) {
  const f = line.split('\t');
  if (f.length < 15) continue;
  const [, name, , , lat, lon, , code, cc] = f;
  if (SKIP.has(code!) || !name || !cc) continue;
  // a few local-government seats have no population recorded
  const pop = Math.max(1000, Number(f[14]) || 0);
  const rank = code === 'PPLC' ? 'C' : code === 'PPLA' ? 'A' : '';
  rows.push([name.replace(/\s+/g, ' '), Number(lat).toFixed(4), Number(lon).toFixed(4), pop, cc, rank].join('\t'));
}
const tsv = gzipSync(rows.join('\n') + '\n', { level: 9 });
writeFileSync(path.join(out, 'places.tsv.gz'), tsv);

// ---------------------------------------------------------------- countries

const numericToAlpha2 = new Map<number, string>();
for (const line of readFileSync(path.join(src, 'countryInfo.txt'), 'utf8').split('\n')) {
  if (line.startsWith('#') || !line.trim()) continue;
  const [alpha2, , numeric] = line.split('\t');
  if (alpha2 && numeric) numericToAlpha2.set(Number(numeric), alpha2);
}
// Natural Earth features without an ISO numeric code
const BY_NAME: Record<string, string> = { Kosovo: 'XK', 'N. Cyprus': 'CY', Somaliland: 'SO' };

const W = 2048;
const H = 1024;
const grid = new Uint8Array(W * H);
const codes: string[] = [''];
const topo = JSON.parse(readFileSync(require.resolve('world-atlas/countries-50m.json'), 'utf8'));
const features = (
  feature(topo, topo.objects.countries) as unknown as {
    features: { id?: string; properties: { name: string }; geometry: never }[];
  }
).features;
const skipped: string[] = [];
for (const f of features) {
  const cc = (f.id !== undefined && numericToAlpha2.get(Number(f.id))) || BY_NAME[f.properties.name];
  if (!cc) {
    skipped.push(f.properties.name);
    continue;
  }
  let idx = codes.indexOf(cc);
  if (idx < 0) idx = codes.push(cc) - 1;
  for (const poly of polygonsOf(f.geometry)) fillPolygon(grid, W, H, poly, idx);
}
if (codes.length > 255) throw new Error('too many countries for a byte');
const rle = encodeRle(grid, W, H);
writeFileSync(path.join(out, 'countries.rle'), rle);
writeFileSync(path.join(out, 'countries.json'), JSON.stringify(codes) + '\n');

console.log(`${rows.length} places (${(tsv.length / 1024).toFixed(0)}KB), ${codes.length - 1} countries (${(rle.length / 1024).toFixed(0)}KB)`);
if (skipped.length) console.log(`no ISO code, left out: ${skipped.join(', ')}`);
