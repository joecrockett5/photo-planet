/** Shared between the map generator (web/scripts/make-earth.ts) and the renderer. */

export const BIOME = {
  deep: 0,
  shallow: 1,
  beach: 2,
  grass: 3,
  forest: 4,
  desert: 5,
  rock: 6,
  ice: 7,
  lake: 8,
} as const;

/**
 * Tiny run-length format: "PPE1", u16 width, u16 height (LE), then
 * (value u8, runLength-1 u8) pairs, row-major.
 */
export function encodeRle(data: Uint8Array, width: number, height: number): Uint8Array {
  const out: number[] = [0x50, 0x50, 0x45, 0x31, width & 255, width >> 8, height & 255, height >> 8];
  let i = 0;
  while (i < data.length) {
    const v = data[i]!;
    let run = 1;
    while (run < 256 && i + run < data.length && data[i + run] === v) run++;
    out.push(v, run - 1);
    i += run;
  }
  return new Uint8Array(out);
}

export function decodeRle(bytes: Uint8Array): { width: number; height: number; data: Uint8Array } {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x50 || bytes[2] !== 0x45 || bytes[3] !== 0x31) throw new Error('bad map');
  const width = bytes[4]! | (bytes[5]! << 8);
  const height = bytes[6]! | (bytes[7]! << 8);
  const data = new Uint8Array(width * height);
  let o = 0;
  for (let i = 8; i + 1 < bytes.length; i += 2) {
    const v = bytes[i]!;
    const end = o + bytes[i + 1]! + 1;
    data.fill(v, o, end);
    o = end;
  }
  return { width, height, data };
}
