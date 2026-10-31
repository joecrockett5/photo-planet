import { describe, expect, it } from 'vitest';
import { angleBetween, clusterItems, fastAtan2, lonDelta, project, unproject, wrapLon, type View } from '../src/planet/geo';
import { BIOME, decodeRle, encodeRle } from '../src/planet/earth-format';

const view: View = { lat: 30, lon: -20, cx: 100, cy: 80, r: 60 };

describe('projection', () => {
  it('puts the view centre in the middle of the disc', () => {
    const p = project(view, 30, -20);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(80);
    expect(p.z).toBeCloseTo(1);
  });

  it('round-trips through unproject on the visible side', () => {
    for (const [lat, lon] of [
      [38.72, -9.14],
      [51.5, -0.12],
      [10, -40],
      [60, 5],
    ] as const) {
      const p = project(view, lat, lon);
      expect(p.z).toBeGreaterThan(0);
      const back = unproject(view, p.x, p.y)!;
      expect(back.lat).toBeCloseTo(lat, 6);
      expect(back.lon).toBeCloseTo(lon, 6);
    }
  });

  it('north is up and east is right', () => {
    expect(project(view, 50, -20).y).toBeLessThan(80);
    expect(project(view, 30, 0).x).toBeGreaterThan(100);
  });

  it('marks the far side as hidden and misses outside the disc', () => {
    expect(project(view, -30, 160).z).toBeLessThan(0);
    expect(unproject(view, 0, 0)).toBeNull();
  });
});

describe('fastAtan2', () => {
  it('matches Math.atan2 to well under a map texel everywhere', () => {
    let worst = 0;
    for (let i = 0; i < 20000; i++) {
      const a = (i / 20000) * Math.PI * 2;
      const r = 0.1 + (i % 7);
      const y = Math.sin(a) * r;
      const x = Math.cos(a) * r;
      worst = Math.max(worst, Math.abs(fastAtan2(y, x) - Math.atan2(y, x)));
    }
    expect(worst * (180 / Math.PI)).toBeLessThan(0.02);
    expect(fastAtan2(0, 0)).toBe(0);
    expect(fastAtan2(1, 0)).toBeCloseTo(Math.PI / 2, 5);
    expect(fastAtan2(0, -1)).toBeCloseTo(Math.PI, 5);
  });
});

describe('angles', () => {
  it('wraps longitudes and finds the short way round', () => {
    expect(wrapLon(190)).toBeCloseTo(-170);
    expect(wrapLon(-540)).toBeCloseTo(180 - 360);
    expect(lonDelta(170, -170)).toBeCloseTo(20);
    expect(lonDelta(-170, 170)).toBeCloseTo(-20);
  });
  it('measures great-circle angles', () => {
    expect(angleBetween(0, 0, 0, 90)).toBeCloseTo(90);
    expect(angleBetween(90, 0, -90, 0)).toBeCloseTo(180);
  });
});

describe('clusterItems', () => {
  const at = (lat: number, lon: number, id: string) => ({ lat, lon, id });
  const items = [at(38.72, -9.14, 'lisbon1'), at(38.7, -9.1, 'lisbon2'), at(41.15, -8.61, 'porto'), at(-33.86, 151.2, 'sydney')];

  it('merges nearby items and keeps distant ones apart', () => {
    const tight = clusterItems(items, 1);
    expect(tight).toHaveLength(3);
    const loose = clusterItems(items, 5);
    expect(loose).toHaveLength(2);
    const iberia = loose.find((c) => c.items.length === 3)!;
    expect(iberia.lat).toBeGreaterThan(38);
    expect(iberia.lat).toBeLessThan(41.2);
  });

  it('clusters across the antimeridian', () => {
    expect(clusterItems([at(-17, 179.9, 'a'), at(-17, -179.9, 'b')], 1)).toHaveLength(1);
  });

  it('is independent of input order', () => {
    const a = clusterItems(items, 5).map((c) => c.items.map((i) => i.id).sort().join());
    const b = clusterItems([...items].reverse(), 5).map((c) => c.items.map((i) => i.id).sort().join());
    expect(a.sort()).toEqual(b.sort());
  });
});

describe('earth map format', () => {
  it('round-trips run-length encoding, including long runs', () => {
    const data = new Uint8Array(1000);
    data.fill(BIOME.grass, 10, 700);
    data[999] = BIOME.ice;
    const out = decodeRle(encodeRle(data, 40, 25));
    expect(out).toMatchObject({ width: 40, height: 25 });
    expect([...out.data]).toEqual([...data]);
  });
});
