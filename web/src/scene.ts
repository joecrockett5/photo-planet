import { attachInput } from './input';
import { motion } from './motion';
import { loadBiomes } from './planet/earth';
import { PlanetControl } from './planet/control';
import type { View } from './planet/geo';
import { PixelCanvas } from './render/pixels';
import { PinLayer } from './render/pins';
import { PlanetRenderer } from './render/planet';
import { Starfield } from './render/stars';

const CLOUD_SPEED = 0.8; // deg/s, relative to the ground

/** Owns the canvas and the frame loop: sky, planet and (later) pins. */
export class Scene {
  readonly px: PixelCanvas;
  readonly control = new PlanetControl();
  readonly pins = new PinLayer();
  private stars = new Starfield();
  private planet = new PlanetRenderer();
  private lastFrame = 0;
  private lastDraw = 0;
  private dirty = true;
  /** Shift of the planet centre (art px), e.g. to make room for a panel. */
  private offset = { x: 0, y: 0 };
  private offsetTarget = { x: 0, y: 0 };
  view: View = { lat: 0, lon: 0, cx: 0, cy: 0, r: 10 };
  onTap: ((x: number, y: number) => void) | null = null;
  onHover: ((x: number, y: number) => void) | null = null;
  onFrame: ((view: View) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.px = new PixelCanvas(canvas);
    this.px.onResize = () => {
      this.stars.resize(this.px.width, this.px.height);
      this.dirty = true;
    };
    this.px.onResize();
    loadBiomes()
      .then((map) => {
        this.planet.setMap(map);
        this.dirty = true;
      })
      .catch((err) => console.error(err));

    attachInput(this.px, {
      dragStart: () => this.control.startDrag(),
      drag: (dx, dy, now) => this.control.dragBy(dx, dy, this.view.r, now),
      dragEnd: (now) => this.control.endDrag(now),
      zoom: (f) => this.control.zoomBy(f),
      tap: (x, y) => this.onTap?.(x, y),
      hover: (x, y) => this.onHover?.(x, y),
    });
    requestAnimationFrame((t) => this.frame(t));
  }

  invalidate(): void {
    this.dirty = true;
  }

  /** Base planet radius for this screen, in art px. */
  baseRadius(): number {
    const { width: w, height: h } = this.px;
    return Math.max(16, Math.min(w * 0.4, h * 0.33));
  }

  /** Move the planet centre (art px) smoothly, e.g. when a panel opens. */
  setOffset(x: number, y: number): void {
    this.offsetTarget = { x, y };
  }

  private computeView(): View {
    const { width: w, height: h } = this.px;
    return {
      lat: this.control.lat,
      lon: this.control.lon,
      cx: Math.floor(w / 2 + this.offset.x),
      cy: Math.floor(h / 2 + this.offset.y),
      // integer radius: the disc grows in whole-pixel steps
      r: Math.round(this.baseRadius() * this.control.zoom),
    };
  }

  private frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = this.lastFrame ? (now - this.lastFrame) / 1000 : 0;
    this.lastFrame = now;
    const reduced = motion.reduced;

    let changed = this.control.update(dt, reduced);
    for (const k of ['x', 'y'] as const) {
      const d = this.offsetTarget[k] - this.offset[k];
      if (Math.abs(d) > 0.05) {
        this.offset[k] += reduced ? d : d * Math.min(1, dt * 8);
        changed = true;
      } else if (d !== 0) {
        this.offset[k] = this.offsetTarget[k];
        changed = true;
      }
    }

    const busy = this.control.moving;
    // Pixel art moves in steps: 30fps is plenty for idle drift and twinkles;
    // go full rate only while being handled.
    const interval = busy && !reduced ? 1000 / 60 - 2 : 1000 / 30 - 2;
    if (!this.dirty && !changed && (reduced || now - this.lastDraw < 1000 / 30 - 2)) return;
    if (!this.dirty && now - this.lastDraw < interval) return;
    this.lastDraw = now;
    this.dirty = false;

    const t = now / 1000;
    this.view = this.computeView();
    const { buf, width: w, height: h } = this.px;
    this.stars.draw(buf, t, this.view.lon, this.view.lat, !reduced);
    this.planet.draw(buf, w, h, this.view, reduced ? 0 : t * CLOUD_SPEED);
    this.pins.draw(buf, w, h, this.view, t, !reduced);
    this.onFrame?.(this.view);
    this.px.present();
  }
}
