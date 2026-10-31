/**
 * Render the favicon and touch icon with the real planet renderer, so the
 * icon is the same pixel planet. Run with `npm run icons -w web`; outputs in
 * web/public are committed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeRle } from '../src/planet/earth-format';
import { C } from '../src/render/palette';
import { PlanetRenderer } from '../src/render/planet';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '../public');
const map = decodeRle(new Uint8Array(readFileSync(path.join(here, '../src/planet/earth-biomes.bin'))));
const planet = new PlanetRenderer(map);

function render(size: number, r: number, background: number | null): Uint32Array {
  const buf = new Uint32Array(size * size).fill(background ?? 0);
  const c = size / 2;
  planet.draw(buf, size, size, { lat: 18, lon: 12, cx: c, cy: c, r }, null);
  return buf;
}

function toRgba(buf: Uint32Array): Buffer {
  return Buffer.from(buf.buffer.slice(0));
}

async function png(buf: Uint32Array, size: number, scale: number, file: string) {
  await sharp(toRgba(buf), { raw: { width: size, height: size, channels: 4 } })
    .resize(size * scale, size * scale, { kernel: 'nearest' })
    .png()
    .toFile(path.join(pub, file));
}

function svg(buf: Uint32Array, size: number): string {
  let rects = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = buf[y * size + x]!;
      if (v >>> 24 === 0) continue;
      const hex = [v & 255, (v >> 8) & 255, (v >> 16) & 255].map((n) => n.toString(16).padStart(2, '0')).join('');
      rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="#${hex}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">${rects}</svg>\n`;
}

const tiny = render(16, 7, null);
writeFileSync(path.join(pub, 'favicon.svg'), svg(tiny, 16));
await png(tiny, 16, 2, 'favicon-32.png');
// iOS fills transparency with black, so give the touch icon the sky colour.
await png(render(36, 14, C.space), 36, 5, 'apple-touch-icon.png');
console.log('icons written to', pub);
