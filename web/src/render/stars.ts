import { C } from './palette';
import { bayer, fbm, hash3, rand3 } from './noise';
import { plot } from './pixels';

const SEED = 20240214;

interface Layer {
  cell: number; // grid cell size in art px; at most one star per cell
  chance: number;
  parallax: number; // art px of shift per degree of planet rotation
  draw: (buf: Uint32Array, w: number, h: number, x: number, y: number, r: number, t: number) => void;
}

/** Twinkle frame (stepped, not smooth) for a star with random `r`. */
function twinkleStep(r: number, t: number, steps: number, speed: number): number {
  const period = 2.5 + r * 5; // seconds
  const phase = r * 997;
  const f = (t * speed) / period + phase;
  return Math.floor((f - Math.floor(f)) * steps);
}

const DIM_COLORS = [C.starDim, C.starDim, C.starDim, C.starMid];
const BRIGHT_COLORS = [C.starBright, C.starBright, C.starWarm, C.starCool];

const LAYERS: Layer[] = [
  {
    // far: faint 1px dust
    cell: 5,
    chance: 0.3,
    parallax: 0.06,
    draw(buf, w, h, x, y, r) {
      plot(buf, w, h, x, y, DIM_COLORS[Math.floor(r * 4)]!);
    },
  },
  {
    // mid: 1px stars, some of which twinkle through palette steps
    cell: 11,
    chance: 0.35,
    parallax: 0.12,
    draw(buf, w, h, x, y, r, t) {
      const color = r < 0.5 ? C.starMid : BRIGHT_COLORS[Math.floor(r * 8) % 4]!;
      if (r > 0.45 && t >= 0) {
        // dims for one or two steps out of eight
        const s = twinkleStep(r, t, 8, 1);
        plot(buf, w, h, x, y, s === 0 ? C.starDim : s === 1 ? C.starMid : color);
      } else {
        plot(buf, w, h, x, y, color);
      }
    },
  },
  {
    // near: bright "plus" stars with twinkling arms
    cell: 34,
    chance: 0.33,
    parallax: 0.2,
    draw(buf, w, h, x, y, r, t) {
      const core = BRIGHT_COLORS[Math.floor(r * 4)]!;
      const big = r > 0.8;
      const s = t >= 0 ? twinkleStep(r, t, 6, 0.8) : 1;
      plot(buf, w, h, x, y, core);
      if (s === 0) return; // arms off: a single bright pixel
      const arm = s === 3 ? core : C.starMid;
      plot(buf, w, h, x - 1, y, arm);
      plot(buf, w, h, x + 1, y, arm);
      plot(buf, w, h, x, y - 1, arm);
      plot(buf, w, h, x, y + 1, arm);
      if (big && s >= 2) {
        plot(buf, w, h, x - 2, y, C.starDim);
        plot(buf, w, h, x + 2, y, C.starDim);
        plot(buf, w, h, x, y - 2, C.starDim);
        plot(buf, w, h, x, y + 2, C.starDim);
      }
    },
  },
];

interface Shooter {
  start: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  length: number;
}

/**
 * Seeded, resolution-independent star field: stars live on fixed grid cells
 * in sky space, so the same sky appears every visit and at every size, and
 * it can scroll (parallax) without repeating.
 */
export class Starfield {
  private nebula = new Uint32Array(0);
  private w = 0;
  private h = 0;
  private shooter: Shooter | null = null;
  private nextShooter = 6 + Math.random() * 10;

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.nebula = new Uint32Array(w * h);
    // A faint dithered Milky Way band across the sky, broken up by noise.
    const cx = w / 2;
    const cy = h / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = x - cx;
        const sy = y - cy;
        // distance from a diagonal line through the centre
        const band = Math.abs(sx * 0.42 + sy * 0.91 + 20) / 70;
        const n = fbm(sx / 46, sy / 46, 4, SEED);
        const v = n * 1.15 - band * 0.55 - 0.18;
        const d = bayer(x, y) * 0.22;
        this.nebula[y * w + x] = v + d > 0.42 ? C.nebula2 : v + d > 0.26 ? C.nebula1 : C.space;
      }
    }
  }

  /**
   * @param t seconds, or -1 to freeze twinkling (reduced motion)
   * @param lon,lat planet rotation in degrees, for parallax
   */
  draw(buf: Uint32Array, t: number, lon: number, lat: number, motion: boolean): void {
    const { w, h } = this;
    buf.set(this.nebula);
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    for (let li = 0; li < LAYERS.length; li++) {
      const layer = LAYERS[li]!;
      const ox = Math.round(lon * layer.parallax);
      const oy = Math.round(-lat * layer.parallax);
      const c = layer.cell;
      // sky coordinates of the top-left screen pixel
      const sx0 = -cx + ox;
      const sy0 = -cy + oy;
      const gx0 = Math.floor(sx0 / c);
      const gy0 = Math.floor(sy0 / c);
      const gx1 = Math.floor((sx0 + w) / c);
      const gy1 = Math.floor((sy0 + h) / c);
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const hsh = hash3(gx, gy, li, SEED);
          if (hsh / 4294967296 >= layer.chance) continue;
          const px = gx * c + (hsh % c) - sx0;
          const py = gy * c + ((hsh >>> 8) % c) - sy0;
          layer.draw(buf, w, h, px, py, rand3(gx, gy, li + 7, SEED), motion ? t : -1);
        }
      }
    }
    if (motion) this.drawShooter(buf, t);
  }

  /** The occasional shooting star: a short stepped streak with a fading tail. */
  private drawShooter(buf: Uint32Array, t: number) {
    const { w, h } = this;
    if (!this.shooter && t > this.nextShooter) {
      const left = Math.random() < 0.5;
      this.shooter = {
        start: t,
        x: Math.floor(w * (0.15 + Math.random() * 0.7)),
        y: Math.floor(h * (0.05 + Math.random() * 0.35)),
        dx: left ? -2 : 2,
        dy: 1,
        length: 14 + Math.floor(Math.random() * 14),
      };
      this.nextShooter = t + 18 + Math.random() * 30;
    }
    const s = this.shooter;
    if (!s) return;
    const step = Math.floor((t - s.start) * 40); // 40 steps a second
    if (step > s.length + 6) {
      this.shooter = null;
      return;
    }
    const tail = [C.starBright, C.starCool, C.starMid, C.starMid, C.starDim, C.starDim];
    for (let i = 0; i < tail.length; i++) {
      const k = step - i;
      if (k < 0 || k > s.length) continue;
      // each step moves 2px sideways and 1px down; fill the gap so it reads as a line
      const x = s.x + s.dx * k;
      const y = s.y + s.dy * k;
      plot(buf, w, h, x, y, tail[i]!);
      plot(buf, w, h, x - s.dx / 2, y, tail[Math.min(i + 1, tail.length - 1)]!);
    }
  }
}
