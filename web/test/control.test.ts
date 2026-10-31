import { describe, expect, it } from 'vitest';
import { PlanetControl, flingVelocity } from '../src/planet/control';
import { lonDelta } from '../src/planet/geo';

/** Drag at a steady speed (art px per 16ms frame) for n frames, starting at t0. */
function drag(c: PlanetControl, pxPerFrame: number, frames: number, t0 = 1000, r = 100) {
  c.startDrag();
  let t = t0;
  for (let i = 0; i < frames; i++) {
    t += 16;
    c.dragBy(pxPerFrame, 0, r, t);
  }
  return t;
}

describe('fling', () => {
  it('measures the pointer speed at release', () => {
    const samples = Array.from({ length: 10 }, (_, i) => ({ t: 1000 + i * 16, dLat: 0, dLon: 2 }));
    expect(flingVelocity(samples, 1000 + 9 * 16).lon).toBeCloseTo(125, 0); // 2° per 16ms
  });

  it('keeps spinning after a quick flick, slowing down smoothly', () => {
    const c = new PlanetControl();
    c.idleEnabled = false;
    const end = drag(c, -6, 12); // dragging left → planet turns east (lon increases)
    c.endDrag(end);
    const speeds: number[] = [];
    let total = 0;
    let second = 0;
    for (let i = 0; i < 4 * 60; i++) {
      const before = c.lon;
      c.update(1 / 60, false);
      const d = lonDelta(before, c.lon); // unwrapped across ±180°
      total += d;
      second += d;
      if (i % 60 === 59) {
        speeds.push(second);
        second = 0;
      }
    }
    expect(total).toBeGreaterThan(90); // a good long coast
    // each second slower than the last, but still moving after 3s
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]!).toBeLessThan(speeds[i - 1]!);
    expect(speeds[3]!).toBeGreaterThan(1);
  });

  it('does not fling if the pointer stopped before letting go', () => {
    const c = new PlanetControl();
    c.idleEnabled = false;
    const end = drag(c, 6, 12);
    c.endDrag(end + 200);
    const before = c.lon;
    c.update(1 / 60, false);
    expect(c.lon).toBe(before);
  });

  it('a new touch catches the spinning globe', () => {
    const c = new PlanetControl();
    c.idleEnabled = false;
    c.endDrag(drag(c, 6, 12));
    c.update(1 / 60, false);
    c.startDrag();
    c.endDrag(5000);
    const before = c.lon;
    c.update(1 / 60, false);
    expect(c.lon).toBe(before);
  });
});
