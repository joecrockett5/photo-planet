import { motion } from './motion';
import { PixelCanvas } from './render/pixels';
import { Starfield } from './render/stars';

/** Owns the canvas and the frame loop; draws sky (and, from M5, the planet). */
export class Scene {
  readonly px: PixelCanvas;
  private stars = new Starfield();
  private last = 0;
  private dirty = true;
  /** Planet rotation in degrees (drives star parallax). */
  lon = 0;
  lat = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.px = new PixelCanvas(canvas);
    this.px.onResize = () => {
      this.stars.resize(this.px.width, this.px.height);
      this.dirty = true;
    };
    this.px.onResize();
    requestAnimationFrame((t) => this.frame(t));
  }

  invalidate(): void {
    this.dirty = true;
  }

  private frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    const animating = !motion.reduced;
    // Pixel art moves in steps; 30fps is plenty for the sky and saves battery.
    if (!this.dirty && (!animating || now - this.last < 1000 / 30 - 2)) return;
    this.last = now;
    this.dirty = false;
    const t = now / 1000;
    this.stars.draw(this.px.buf, t, this.lon, this.lat, animating);
    this.px.present();
  }
}
