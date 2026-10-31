import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BIOME, decodeRle } from '../src/planet/earth-format';

// Sanity-check the committed geography: well-known places land on the right biome.
const map = decodeRle(new Uint8Array(readFileSync(new URL('../src/planet/earth-biomes.bin', import.meta.url))));
const at = (lat: number, lon: number) =>
  map.data[Math.floor(((90 - lat) / 180) * map.height) * map.width + Math.floor(((lon + 180) / 360) * map.width)];
const LAND = [BIOME.beach, BIOME.grass, BIOME.forest, BIOME.desert, BIOME.rock, BIOME.ice];

describe('earth map', () => {
  it('is 2048x1024', () => expect([map.width, map.height]).toEqual([2048, 1024]));
  it.each([
    ['Paris', 48.86, 2.35],
    ['Nairobi', -1.29, 36.82],
    ['Denver', 39.74, -104.99],
    ['Beijing', 39.9, 116.4],
    ['São Paulo', -23.55, -46.63],
    ['Alice Springs', -23.7, 133.88],
  ])('%s is land', (_, lat, lon) => expect(LAND).toContain(at(lat, lon)));
  it.each([
    ['mid-Atlantic', 30, -40],
    ['mid-Pacific', 0, -150],
    ['Indian Ocean', -20, 80],
  ])('%s is deep ocean', (_, lat, lon) => expect(at(lat, lon)).toBe(BIOME.deep));
  it('has a Sahara and an Antarctic ice sheet', () => {
    expect(at(23, 10)).toBe(BIOME.desert);
    expect(at(-80, 0)).toBe(BIOME.ice);
    expect(at(72, -40)).toBe(BIOME.ice); // Greenland
  });
});
