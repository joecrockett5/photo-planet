import { clamp, lonDelta, wrapLon } from './geo';

const IDLE_SPEED = -2.4; // deg/s; negative = the surface drifts west → east, like the real Earth
const IDLE_DELAY = 3.5; // seconds after the last touch before idle spin resumes
const FRICTION = 3.2; // inertia decay rate (1/s)
const MAX_LAT = 80;
export const MIN_ZOOM = 0.7;
export const MAX_ZOOM = 3.4;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

interface Flight {
  fromLat: number;
  fromLon: number;
  dLat: number;
  dLon: number;
  fromZoom: number;
  toZoom: number;
  t: number;
  duration: number;
}

/**
 * The planet's orientation and zoom, and how they move: drag with inertia,
 * gentle idle spin, wheel/pinch zoom and smooth fly-to.
 */
export class PlanetControl {
  lat = 22;
  lon = 12;
  zoom = 1;
  private vLat = 0;
  private vLon = 0;
  private idleSpeed = 0;
  private sinceTouch = IDLE_DELAY; // start spinning straight away
  private dragging = false;
  private flight: Flight | null = null;
  private samples: { t: number; dLat: number; dLon: number }[] = [];
  /** When false (reduced motion, or a panel is open), no idle spin. */
  idleEnabled = true;
  /**
   * Bumped on every change to lat/lon/zoom, however it happened (input
   * handlers run between frames), so the renderer knows to redraw.
   */
  version = 0;

  /** Drag by a screen delta (art px) on a disc of radius r (art px). */
  dragBy(dx: number, dy: number, r: number, now: number): void {
    this.flight = null;
    this.dragging = true;
    this.sinceTouch = 0;
    // A full disc-width drag turns the globe by ~115°: feels like grabbing the surface.
    const k = 57.3 / r;
    const dLon = -dx * k;
    const dLat = dy * k;
    this.lon = wrapLon(this.lon + dLon);
    this.lat = clamp(this.lat + dLat, -MAX_LAT, MAX_LAT);
    this.version++;
    this.samples.push({ t: now, dLat, dLon });
    while (this.samples.length && now - this.samples[0]!.t > 100) this.samples.shift();
  }

  startDrag(): void {
    this.touched = true;
    this.dragging = true;
    this.flight = null;
    this.vLat = this.vLon = 0;
    this.idleSpeed = 0;
    this.samples = [];
    this.sinceTouch = 0;
  }

  endDrag(now: number, reducedMotion = false): void {
    this.dragging = false;
    if (reducedMotion) {
      // no glide after letting go
      this.samples = [];
      return;
    }
    const recent = this.samples.filter((s) => now - s.t < 100);
    if (recent.length >= 2) {
      const span = Math.max(16, now - recent[0]!.t) / 1000;
      this.vLon = clamp(recent.reduce((a, s) => a + s.dLon, 0) / span, -400, 400);
      this.vLat = clamp(recent.reduce((a, s) => a + s.dLat, 0) / span, -300, 300);
    }
    this.samples = [];
  }

  /** Postpone idle spin (e.g. while the mouse rests on a pin). */
  poke(): void {
    this.sinceTouch = 0;
    this.idleSpeed = 0;
  }

  zoomBy(factor: number): void {
    this.touched = true;
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.sinceTouch = 0;
    this.version++;
  }

  /** Keyboard nudge: a short spin in a direction (degrees/second impulse). */
  nudge(dLat: number, dLon: number): void {
    this.touched = true;
    this.flight = null;
    this.sinceTouch = 0;
    this.idleSpeed = 0;
    this.vLat = clamp(this.vLat + dLat, -120, 120);
    this.vLon = clamp(this.vLon + dLon, -200, 200);
  }

  setZoom(z: number): void {
    this.zoom = clamp(z, MIN_ZOOM, MAX_ZOOM);
    this.sinceTouch = 0;
    this.version++;
  }

  /** Smoothly rotate so lat/lon faces the viewer (optionally zooming). */
  flyTo(lat: number, lon: number, zoom = this.zoom, duration = 0.9): void {
    this.vLat = this.vLon = 0;
    this.idleSpeed = 0;
    this.sinceTouch = 0;
    const toLat = clamp(lat, -MAX_LAT, MAX_LAT);
    this.flight = {
      fromLat: this.lat,
      fromLon: this.lon,
      dLat: toLat - this.lat,
      dLon: lonDelta(this.lon, lon),
      fromZoom: this.zoom,
      toZoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM),
      t: 0,
      duration,
    };
  }

  /** True until someone drags, zooms or flies somewhere. */
  get untouched(): boolean {
    return !this.touched;
  }
  private touched = false;

  /** Dragged, flying, or gliding after a drag (not just idle spin). */
  get handled(): boolean {
    return this.dragging || this.flight !== null || Math.abs(this.vLon) + Math.abs(this.vLat) > 0.05;
  }

  /** Advance by dt seconds. Returns true if anything changed. */
  update(dt: number, reducedMotion: boolean): boolean {
    dt = Math.min(dt, 0.1);
    const before = this.lat + this.lon * 1000 + this.zoom * 1e6;
    if (this.flight) {
      const f = this.flight;
      f.t = reducedMotion ? f.duration : f.t + dt;
      const e = easeInOut(Math.min(1, f.t / f.duration));
      this.lat = f.fromLat + f.dLat * e;
      this.lon = wrapLon(f.fromLon + f.dLon * e);
      this.zoom = f.fromZoom + (f.toZoom - f.fromZoom) * e;
      if (f.t >= f.duration) this.flight = null;
    } else if (!this.dragging) {
      this.sinceTouch += dt;
      const decay = Math.exp(-FRICTION * dt);
      this.vLon *= decay;
      this.vLat *= decay;
      if (Math.abs(this.vLon) < 0.05) this.vLon = 0;
      if (Math.abs(this.vLat) < 0.05) this.vLat = 0;
      // ease the idle spin in and out rather than snapping
      const target = this.idleEnabled && !reducedMotion && this.sinceTouch > IDLE_DELAY ? IDLE_SPEED : 0;
      this.idleSpeed += (target - this.idleSpeed) * Math.min(1, dt * 0.8);
      if (Math.abs(this.idleSpeed) < 0.01 && target === 0) this.idleSpeed = 0;
      this.lon = wrapLon(this.lon + (this.vLon + this.idleSpeed) * dt);
      this.lat = clamp(this.lat + this.vLat * dt, -MAX_LAT, MAX_LAT);
      if (Math.abs(this.lat) >= MAX_LAT) this.vLat = 0;
    }
    const changed = this.lat + this.lon * 1000 + this.zoom * 1e6 !== before;
    if (changed) this.version++;
    return changed;
  }
}
