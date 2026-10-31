/** Small deterministic helpers: integer hashing, value noise, ordered dithering. */

/** 32-bit integer hash of up to three ints, mixed with a seed. Returns [0, 2^32). */
export function hash3(x: number, y: number, z: number, seed = 0): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ (y | 0), 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16) ^ (z | 0), 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/** Hash as a float in [0, 1). */
export function rand3(x: number, y: number, z: number, seed = 0): number {
  return hash3(x, y, z, seed) / 4294967296;
}

/** Seeded PRNG (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** 2D value noise in [0, 1). */
export function valueNoise(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = smooth(x - xi);
  const ty = smooth(y - yi);
  const a = rand3(xi, yi, 0, seed);
  const b = rand3(xi + 1, yi, 0, seed);
  const c = rand3(xi, yi + 1, 0, seed);
  const d = rand3(xi + 1, yi + 1, 0, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Fractal value noise, roughly in [0, 1). */
export function fbm(x: number, y: number, octaves: number, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x, y, seed + i * 131) * amp;
    norm += amp;
    amp *= 0.5;
    x *= 2.03;
    y *= 2.03;
  }
  return sum / norm;
}

/** 4x4 Bayer matrix, normalised to [0, 1). */
export const BAYER4 = new Float32Array([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16));

export function bayer(x: number, y: number): number {
  return BAYER4[((y & 3) << 2) | (x & 3)]!;
}
