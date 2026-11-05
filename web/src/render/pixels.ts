/**
 * A full-screen canvas at low "art" resolution. Each art pixel covers an
 * integer number of *device* pixels, whatever devicePixelRatio is, so the
 * nearest-neighbour upscale stays perfectly crisp.
 */
export class PixelCanvas {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  width = 0;
  height = 0;
  /** Device pixels per art pixel (integer). */
  devicePx = 1;
  /** CSS pixels per art pixel (devicePx / devicePixelRatio). */
  cssPx = 1;
  image!: ImageData;
  buf!: Uint32Array;
  onResize: (() => void) | null = null;

  /**
   * A fixed, full-screen, invisible element we measure for the screen size.
   * window.innerHeight can't be trusted: iOS home-screen apps with a
   * translucent status bar report it without the status bar while the page
   * starts underneath it, which left a strip of bare background at the bottom.
   */
  private sizer: HTMLElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.sizer = document.createElement('div');
    this.sizer.setAttribute('aria-hidden', 'true');
    this.sizer.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none;';
    document.body.prepend(this.sizer);
    this.resize();
    addEventListener('resize', () => this.resize());
    // also catches iOS toolbars and the status bar settling after launch
    new ResizeObserver(() => this.resize()).observe(this.sizer);
    this.watchDpr();
  }

  /** Target CSS px per art pixel, by screen size (the spec asks for ~3–4). */
  static cssScaleFor(w: number, h: number): number {
    const short = Math.min(w, h);
    if (short < 600) return 3;
    if (short < 1300) return 4;
    return Math.round(short / 300);
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.sizer.getBoundingClientRect();
    const layoutW = Math.max(rect.width, window.innerWidth);
    const layoutH = Math.max(rect.height, window.innerHeight);
    const { w: vw, h: vh } = fullScreenSize(layoutW, layoutH);
    // how far the real screen extends below the page's layout (iOS home-screen apps)
    document.documentElement.style.setProperty('--xb', `${Math.max(0, vh - layoutH)}px`);
    this.devicePx = Math.max(1, Math.round(PixelCanvas.cssScaleFor(vw, vh) * dpr));
    this.cssPx = this.devicePx / dpr;
    const w = Math.ceil((vw * dpr) / this.devicePx);
    const h = Math.ceil((vh * dpr) / this.devicePx);
    if (w === this.width && h === this.height && this.image) {
      this.applyCss();
      return;
    }
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.image = this.ctx.createImageData(w, h);
    this.buf = new Uint32Array(this.image.data.buffer);
    this.applyCss();
    this.onResize?.();
  }

  private applyCss() {
    this.canvas.style.width = `${this.width * this.cssPx}px`;
    this.canvas.style.height = `${this.height * this.cssPx}px`;
    const root = document.documentElement.style;
    root.setProperty('--px', `${this.cssPx}px`);
    // UI text uses half-size pixels (still whole device pixels, so still crisp):
    // at full art-pixel size the "tiny" title would be huge.
    const dpr = this.devicePx / this.cssPx;
    root.setProperty('--tpx', `${Math.max(1, Math.round(this.devicePx / 2)) / dpr}px`);
  }

  private watchDpr() {
    // Fires when the window moves to a screen with a different DPR, or on browser zoom.
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener(
      'change',
      () => {
        this.resize();
        this.watchDpr();
      },
      { once: true },
    );
  }

  present(): void {
    this.ctx.putImageData(this.image, 0, 0);
  }

  /** Client (CSS px) coordinates → art pixel coordinates (fractional). */
  toArt(clientX: number, clientY: number): { x: number; y: number } {
    return { x: clientX / this.cssPx, y: clientY / this.cssPx };
  }

  /** Art pixel coordinates → client CSS px. */
  toClient(x: number, y: number): { x: number; y: number } {
    return { x: x * this.cssPx, y: y * this.cssPx };
  }
}

/** Plot a pixel if it's on screen. */
export function plot(buf: Uint32Array, w: number, h: number, x: number, y: number, color: number): void {
  if (x >= 0 && y >= 0 && x < w && y < h) buf[y * w + x] = color;
}

/**
 * The size to draw at. In a full-screen app on a phone (added to the home
 * screen), iOS lays the page out one status-bar height short of the screen:
 * innerHeight, 100vh and even fixed elements all stop ~50px above the bottom,
 * which left a strip without stars. There, use the physical screen size. Only
 * for touch devices whose app spans the whole screen width (not desktop
 * installed apps or split views), and never smaller than the layout.
 */
export function fullScreenSize(layoutW: number, layoutH: number): { w: number; h: number } {
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone =
    nav.standalone === true || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
  if (!standalone || !matchMedia('(pointer: coarse)').matches || !screen?.width || !screen?.height) {
    return { w: layoutW, h: layoutH };
  }
  // iOS reports screen size in portrait whatever the orientation
  const short = Math.min(screen.width, screen.height);
  const long = Math.max(screen.width, screen.height);
  const portrait = layoutH >= layoutW;
  const sw = portrait ? short : long;
  const sh = portrait ? long : short;
  if (Math.abs(sw - layoutW) > 2) return { w: layoutW, h: layoutH };
  return { w: layoutW, h: Math.max(layoutH, sh) };
}
