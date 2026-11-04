import { BIOME } from '../planet/earth-format';
import type { EarthMap } from '../planet/earth';
import { DEG, fastAtan2, type View } from '../planet/geo';
import { BAYER4, fbm, rand3 } from './noise';
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

// Clouds thin out (dithered) as you zoom in, like dropping below them.
const CLOUDS_FULL_R = 240; // art px of planet radius: full cover up to here
const CLOUDS_GONE_R = 560; // none from here

// Ground-fixed grid of "clear sky" around photos (clouds drift, clearings don't).
const CLEAR_W = 1024;
const CLEAR_H = 512;
const CLEAR_RADIUS_DEG = 4;

// Smooth tileable noise for nudging map samples when zoomed past the map's
// own detail, so coastlines come out irregular rather than as square steps.
const WARP_N = 64;
const WARP = (() => {
  const t = new Float32Array(WARP_N * WARP_N * 2);
  for (let i = 0; i < t.length; i++) t[i] = rand3(i, i >> 7, 0, 777) - 0.5;
  return t;
})();
/** Smooth noise at (x, y): both channels at once, into OUT[0], OUT[1]. */
function warpAt(x: number, y: number, out: Float64Array): void {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const x0 = xi & (WARP_N - 1);
  const y0 = yi & (WARP_N - 1);
  const x1 = (x0 + 1) & (WARP_N - 1);
  const y1 = (y0 + 1) & (WARP_N - 1);
  const i00 = (y0 * WARP_N + x0) * 2;
  const i10 = (y0 * WARP_N + x1) * 2;
  const i01 = (y1 * WARP_N + x0) * 2;
  const i11 = (y1 * WARP_N + x1) * 2;
  for (let c = 0; c < 2; c++) {
    const a = WARP[i00 + c]!;
    const b = WARP[i10 + c]!;
    const top = a + (b - a) * fx;
    const bottom = WARP[i01 + c]! + (WARP[i11 + c]! - WARP[i01 + c]!) * fx;
    out[c] = top + (bottom - top) * fy;
  }
}

/**
 * Exact sphere maths for a point (nx, ny) on the unit disc, rotated by the
 * view: OUT[0] = u (longitude, 0..1), OUT[1] = v (latitude, 0..1), OUT[2] =
 * light. A plain function writing into a typed array keeps V8's hot loop fast.
 */
function sphereAt(nx: number, ny: number, r2: number, rot: Float64Array, out: Float64Array): void {
  const sp = rot[0]!;
  const cp = rot[1]!;
  const sl = rot[2]!;
  const cl = rot[3]!;
  const nz = Math.sqrt(1 - r2);
  // view → world: tilt by lat, then spin by lon
  const wy = ny * cp + nz * sp;
  const z1 = -ny * sp + nz * cp;
  const wx = nx * cl + z1 * sl;
  const wz = -nx * sl + z1 * cl;
  out[0] = (fastAtan2(wx, wz) + Math.PI) / (Math.PI * 2);
  // asin(wy) as atan2(wy, |horizontal|): the horizontal length is free here
  out[1] = 0.5 - fastAtan2(wy, Math.sqrt(wx * wx + wz * wz)) / Math.PI;
  out[2] = nx * L[0] + ny * L[1] + nz * L[2];
}

const ROT = new Float64Array(4);
const SA = new Float64Array(3); // span start
const SB = new Float64Array(3); // span end
const WARP_OUT = new Float64Array(2);

export interface PlanetDrawOptions {
  /** Cloud drift in degrees, or null for no clouds. */
  cloudLon: number | null;
  /** 0..1: ordered-dither dissolve-in while the map loads. */
  reveal?: number;
  /** Clear the clouds around these spots (photos), or null to leave them. */
  clearings?: Uint8Array | null;
}

/** Software-rendered pixel planet: ray-cast every pixel of the disc. */
export class PlanetRenderer {
  private clouds: Uint8Array | null = null;

  constructor(private map: EarthMap | null = null) {}

  /** Half-resolution copy for normal zoom, where the full map would just add speckle. */
  private half: EarthMap | null = null;

  setMap(map: EarthMap): void {
    this.map = map;
    const w = map.width >> 1;
    const h = map.height >> 1;
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = map.data[(y * 2) * map.width + x * 2]!;
    this.half = { width: w, height: h, data };
  }

  /**
   * A ground-fixed grid of how clear the sky should be around each spot
   * (255 at the spot, fading to 0 at CLEAR_RADIUS_DEG). Rebuilt when photos change.
   */
  static clearingsFor(spots: { lat: number; lon: number }[]): Uint8Array {
    const grid = new Uint8Array(CLEAR_W * CLEAR_H);
    const ry = (CLEAR_RADIUS_DEG / 180) * CLEAR_H; // radius in grid rows
    for (const { lat, lon } of spots) {
      const cy = ((90 - lat) / 180) * CLEAR_H;
      const cx = ((lon + 180) / 360) * CLEAR_W;
      const cos = Math.max(0.05, Math.cos(lat * DEG));
      const rx = Math.min(CLEAR_W / 2, (ry * 2) / cos); // columns are half as tall as rows in degrees
      for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(CLEAR_H - 1, Math.ceil(cy + ry)); y++) {
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const dx = (x + 0.5 - cx) / rx;
          const dy = (y + 0.5 - cy) / ry;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d >= 1) continue;
          const i = y * CLEAR_W + (((x % CLEAR_W) + CLEAR_W) % CLEAR_W);
          const v = Math.round((1 - d) * 255);
          if (v > grid[i]!) grid[i] = v;
        }
      }
    }
    return grid;
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
  draw(buf: Uint32Array, w: number, h: number, view: View, opts: PlanetDrawOptions): void {
    const { cloudLon, reveal = 1, clearings = null } = opts;
    const { cx, cy, r } = view;
    // Pick the map level: full detail only once it's needed (> ~4 texels per pixel is just speckle).
    const full = this.map;
    const texelsPerPx = full ? full.width / (2 * Math.PI * r) : 1;
    const map = texelsPerPx > 4 && this.half ? this.half : full;
    // Past the map's own detail, nudge samples with smooth noise (in texels).
    const warp = texelsPerPx < 1 ? Math.min(0.7, 1 - texelsPerPx) : 0;
    const cloudAmount = Math.min(1, Math.max(0, (CLOUDS_GONE_R - r) / (CLOUDS_GONE_R - CLOUDS_FULL_R)));
    const sp = Math.sin(view.lat * DEG);
    const cp = Math.cos(view.lat * DEG);
    const sl = Math.sin(view.lon * DEG);
    const cl = Math.cos(view.lon * DEG);
    const mw = map?.width ?? 1;
    const mh = map?.height ?? 1;
    const data = map?.data;
    const clouds = cloudLon !== null && cloudAmount > 0 ? this.cloudMask() : null;
    const cloudShift = cloudLon !== null ? Math.floor(((cloudLon % 360) + 360) % 360 / 360 * CLOUD_W) : 0;
    const invR = 1 / r;
    const atmo2 = (1 + 1.6 * invR) ** 2;
    const x0 = Math.max(0, Math.floor(cx - r - 2));
    const x1 = Math.min(w - 1, Math.ceil(cx + r + 2));
    const y0 = Math.max(0, Math.floor(cy - r - 2));
    const y1 = Math.min(h - 1, Math.ceil(cy + r + 2));

    ROT[0] = sp;
    ROT[1] = cp;
    ROT[2] = sl;
    ROT[3] = cl;
    // Zoomed in, the visible patch is nearly flat: map coordinates change
    // almost linearly along a row. Do the exact sphere maths every SPAN pixels
    // and interpolate between (several times cheaper); near the limb, the
    // poles or the antimeridian it falls back to every pixel.
    const SPAN = r >= 160 ? 8 : 1;
    const LIMB = 0.91; // r² limit for interpolated spans (nz > 0.3)

    for (let y = y0; y <= y1; y++) {
      const ny = -(y + 0.5 - cy) * invR;
      const row = y * w;
      const bayerRow = (y & 3) << 2;
      let spanEnd = -1; // exclusive; x < spanEnd means "inside an interpolated span"
      let spanX = 0;
      let uA = 0;
      let du = 0;
      let vA = 0;
      let dv = 0;
      let lA = 0;
      let dl = 0;
      let haveB = false; // SB already holds the exact values at spanEnd
      let retryAt = x0; // after a failed span attempt, don't retry for SPAN pixels
      for (let x = x0; x <= x1; x++) {
        const d = BAYER4[bayerRow | (x & 3)]!;
        let u: number;
        let v: number;
        let lightN: number;
        if (x >= spanEnd && x >= retryAt && SPAN > 1 && x + SPAN <= x1 + 1) {
          // try to start a new span [x, x + SPAN)
          const nxA = (x + 0.5 - cx) * invR;
          const nxB = (x + SPAN + 0.5 - cx) * invR;
          const r2A = nxA * nxA + ny * ny;
          const r2B = nxB * nxB + ny * ny;
          if (r2A < LIMB && r2B < LIMB) {
            if (haveB && x === spanEnd) SA.set(SB);
            else sphereAt(nxA, ny, r2A, ROT, SA);
            sphereAt(nxB, ny, r2B, ROT, SB);
            let dU = SB[0]! - SA[0]!;
            if (dU > 0.5) dU -= 1;
            else if (dU < -0.5) dU += 1;
            const dV = SB[1]! - SA[1]!;
            // up to ~6° per span; more means a pole or the antimeridian is near
            if ((dU < 0 ? -dU : dU) < 1 / 60 && (dV < 0 ? -dV : dV) < 1 / 30) {
              spanX = x;
              spanEnd = x + SPAN;
              uA = SA[0]!;
              vA = SA[1]!;
              lA = SA[2]!;
              du = dU / SPAN;
              dv = dV / SPAN;
              dl = (SB[2]! - lA) / SPAN;
              haveB = true;
            } else {
              haveB = false;
              retryAt = x + SPAN;
            }
          } else {
            haveB = false;
            retryAt = x + SPAN;
          }
        }
        if (d >= reveal) continue;
        if (x < spanEnd) {
          const i = x - spanX;
          u = uA + du * i;
          if (u < 0) u += 1;
          else if (u >= 1) u -= 1;
          v = vA + dv * i;
          lightN = lA + dl * i;
        } else {
          const nx = (x + 0.5 - cx) * invR;
          const r2 = nx * nx + ny * ny;
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
          sphereAt(nx, ny, r2, ROT, SA);
          haveB = false;
          u = SA[0]!;
          v = SA[1]!;
          lightN = SA[2]!;
        }

        const light = lightN + (d - 0.5) * DITHER;
        const level = light > T_LIT ? 2 : light > T_SHADE ? 1 : 0;

        if (clouds && d < cloudAmount) {
          const cxm = (((u * CLOUD_W) | 0) + cloudShift) % CLOUD_W;
          const cym = (v * CLOUD_H) | 0;
          if (clouds[(cym >= CLOUD_H ? CLOUD_H - 1 : cym) * CLOUD_W + cxm]) {
            // around photos the clouds part, with a dithered edge
            const clear = clearings
              ? clearings[Math.min(CLEAR_H - 1, (v * CLEAR_H) | 0) * CLEAR_W + Math.min(CLEAR_W - 1, (u * CLEAR_W) | 0)]!
              : 0;
            if (clear < 96 + d * 96) {
              buf[row + x] = CLOUD[level]!;
              continue;
            }
          }
        }
        let biome: number = BIOME.deep;
        if (data) {
          let fx = u * mw;
          let fy = v * mh;
          if (warp) {
            warpAt(fx * 0.75, fy * 0.75, WARP_OUT);
            fx += WARP_OUT[0]! * warp * 2;
            fy += WARP_OUT[1]! * warp * 2;
          }
          let tx = fx | 0;
          if (tx >= mw) tx -= mw;
          else if (tx < 0) tx += mw;
          let ty = fy | 0;
          if (ty >= mh) ty = mh - 1;
          else if (ty < 0) ty = 0;
          biome = data[ty * mw + tx]!;
        }
        buf[row + x] = FLAT[biome * 3 + level]!;
      }
    }
  }
}
