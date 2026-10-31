import { BIOME } from '../planet/earth-format';
import type { EarthMap } from '../planet/earth';
import { DEG, type View } from '../planet/geo';
import { bayer, fbm } from './noise';
import { C } from './palette';

/** Per-biome colour ramp: [night, shade, lit]. */
const RAMPS: number[][] = [];
RAMPS[BIOME.deep] = [C.oceanNight, C.oceanDark, C.ocean];
RAMPS[BIOME.shallow] = [C.oceanDark, C.shallowDark, C.shallow];
RAMPS[BIOME.beach] = [C.landNight, C.desertDark, C.beach];
RAMPS[BIOME.grass] = [C.landNight, C.grassDark, C.grass];
RAMPS[BIOME.forest] = [C.landNight, C.forestDark, C.forest];
RAMPS[BIOME.desert] = [C.landNight, C.desertDark, C.desert];
RAMPS[BIOME.rock] = [C.landNight, C.rockDark, C.rock];
RAMPS[BIOME.ice] = [C.iceNight, C.iceDark, C.ice];
const CLOUD = [C.iceNight, C.iceDark, C.ice];
const FLAT = new Uint32Array(RAMPS.flat());

// Light from the upper left, a little in front: the terminator sits lower right.
const L = (() => {
  const v = [-0.55, 0.45, 0.7];
  const n = Math.hypot(v[0]!, v[1]!, v[2]!);
  return v.map((c) => c / n) as [number, number, number];
})();

// Dithered light thresholds: night | shade | lit
const T_SHADE = 0.0;
const T_LIT = 0.36;
const DITHER = 0.26;

const CLOUD_W = 512;
const CLOUD_H = 256;

/** Software-rendered pixel planet: ray-cast every pixel of the disc. */
export class PlanetRenderer {
  private clouds: Uint8Array | null = null;

  constructor(private map: EarthMap | null = null) {}

  setMap(map: EarthMap): void {
    this.map = map;
  }

  /** A sparse, horizontally tileable cloud mask (built lazily, ~30ms once). */
  private cloudMask(): Uint8Array {
    if (this.clouds) return this.clouds;
    const mask = new Uint8Array(CLOUD_W * CLOUD_H);
    for (let y = 0; y < CLOUD_H; y++) {
      const lat = 90 - ((y + 0.5) / CLOUD_H) * 180;
      // more cloud in the tropics and mid-latitude storm belts, little at the poles
      const belt = 0.5 * Math.exp(-((lat / 12) ** 2)) + 0.6 * Math.exp(-(((Math.abs(lat) - 52) / 14) ** 2));
      for (let x = 0; x < CLOUD_W; x++) {
        const t = x / CLOUD_W;
        const f = (xx: number) => fbm(xx / 14, y / 8, 4, 4242);
        // blend two samples one period apart so the seam at ±180° disappears
        const n = f(x) * (1 - t) + f(x - CLOUD_W) * t;
        mask[y * CLOUD_W + x] = n + belt * 0.12 > 0.69 ? 1 : 0;
      }
    }
    return (this.clouds = mask);
  }

  /**
   * @param cloudLon cloud drift in degrees (null hides clouds)
   */
  draw(buf: Uint32Array, w: number, h: number, view: View, cloudLon: number | null): void {
    const map = this.map;
    const { cx, cy, r } = view;
    const sp = Math.sin(view.lat * DEG);
    const cp = Math.cos(view.lat * DEG);
    const sl = Math.sin(view.lon * DEG);
    const cl = Math.cos(view.lon * DEG);
    const mw = map?.width ?? 1;
    const mh = map?.height ?? 1;
    const data = map?.data;
    const clouds = cloudLon !== null ? this.cloudMask() : null;
    const cloudShift = cloudLon !== null ? Math.floor(((cloudLon % 360) + 360) % 360 / 360 * CLOUD_W) : 0;
    const invR = 1 / r;
    const atmo2 = (1 + 1.6 * invR) ** 2;
    const x0 = Math.max(0, Math.floor(cx - r - 2));
    const x1 = Math.min(w - 1, Math.ceil(cx + r + 2));
    const y0 = Math.max(0, Math.floor(cy - r - 2));
    const y1 = Math.min(h - 1, Math.ceil(cy + r + 2));
    const TWO_PI = Math.PI * 2;

    for (let y = y0; y <= y1; y++) {
      const ny = -(y + 0.5 - cy) * invR;
      const row = y * w;
      for (let x = x0; x <= x1; x++) {
        const nx = (x + 0.5 - cx) * invR;
        const r2 = nx * nx + ny * ny;
        const d = bayer(x, y);
        if (r2 > 1) {
          // thin atmosphere rim, lit side only
          if (r2 <= atmo2) {
            const inv = 1 / Math.sqrt(r2);
            const lit = (nx * L[0] + ny * L[1]) * inv + (d - 0.5) * 0.5;
            if (lit > 0.3) buf[row + x] = C.atmo;
            else if (lit > -0.05) buf[row + x] = C.atmoDim;
          }
          continue;
        }
        const nz = Math.sqrt(1 - r2);
        // view → world: tilt by lat, then spin by lon
        const wy = ny * cp + nz * sp;
        const z1 = -ny * sp + nz * cp;
        const wx = nx * cl + z1 * sl;
        const wz = -nx * sl + z1 * cl;
        const lat = Math.asin(wy > 1 ? 1 : wy < -1 ? -1 : wy); // radians
        const lon = Math.atan2(wx, wz); // radians, -π..π
        const u = (lon + Math.PI) / TWO_PI; // 0..1
        const v = 0.5 - lat / Math.PI; // 0..1

        const light = nx * L[0] + ny * L[1] + nz * L[2] + (d - 0.5) * DITHER;
        const level = light > T_LIT ? 2 : light > T_SHADE ? 1 : 0;

        if (clouds) {
          const cxm = (((u * CLOUD_W) | 0) + cloudShift) % CLOUD_W;
          const cym = (v * CLOUD_H) | 0;
          if (clouds[(cym >= CLOUD_H ? CLOUD_H - 1 : cym) * CLOUD_W + cxm]) {
            buf[row + x] = CLOUD[level]!;
            continue;
          }
        }
        let biome: number = BIOME.deep;
        if (data) {
          let tx = (u * mw) | 0;
          if (tx >= mw) tx = mw - 1;
          let ty = (v * mh) | 0;
          if (ty >= mh) ty = mh - 1;
          biome = data[ty * mw + tx]!;
        }
        buf[row + x] = FLAT[biome * 3 + level]!;
      }
    }
  }
}
