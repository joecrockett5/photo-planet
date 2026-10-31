import type { PixelCanvas } from './render/pixels';

export interface InputHandlers {
  dragStart(): void;
  drag(dxArt: number, dyArt: number, now: number): void;
  dragEnd(now: number): void;
  zoom(factor: number): void;
  /** A tap/click that didn't move: art-pixel coordinates. */
  tap(x: number, y: number): void;
  hover(x: number, y: number): void;
}

const TAP_SLOP = 8; // CSS px
const TAP_MS = 500;

/** Mouse, touch and pen on the canvas: drag, pinch, wheel, tap and hover. */
export function attachInput(px: PixelCanvas, h: InputHandlers): void {
  const el = px.canvas;
  const pointers = new Map<number, { x: number; y: number }>();
  let downAt = 0;
  let downPos = { x: 0, y: 0 };
  let moved = 0;
  let pinchDist = 0;
  let multi = false;

  const center = () => {
    let x = 0;
    let y = 0;
    for (const p of pointers.values()) (x += p.x), (y += p.y);
    return { x: x / pointers.size, y: y / pointers.size };
  };
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      downAt = performance.now();
      downPos = { x: e.clientX, y: e.clientY };
      moved = 0;
      multi = false;
      h.dragStart();
    } else {
      multi = true;
      pinchDist = spread();
    }
  });

  el.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') {
        const a = px.toArt(e.clientX, e.clientY);
        h.hover(a.x, a.y);
      }
      return;
    }
    const before = center();
    p.x = e.clientX;
    p.y = e.clientY;
    const after = center();
    moved = Math.max(moved, Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y));
    h.drag((after.x - before.x) / px.cssPx, (after.y - before.y) / px.cssPx, performance.now());
    if (pointers.size >= 2) {
      const d = spread();
      if (pinchDist > 0 && d > 0) h.zoom(d / pinchDist);
      pinchDist = d;
    }
  });

  const up = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 1) {
      pinchDist = 0;
      return;
    }
    if (pointers.size > 0) return;
    const now = performance.now();
    h.dragEnd(now);
    if (!multi && e.type === 'pointerup' && moved < TAP_SLOP && now - downAt < TAP_MS) {
      const a = px.toArt(e.clientX, e.clientY);
      h.tap(a.x, a.y);
    }
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !pointers.size) h.hover(-1, -1);
  });

  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      // trackpad pinch arrives as ctrl+wheel with small deltas
      h.zoom(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)));
    },
    { passive: false },
  );

  // Safari's own pinch gestures would zoom the page; keep them for the planet.
  el.addEventListener('gesturestart', (e) => e.preventDefault());
}
