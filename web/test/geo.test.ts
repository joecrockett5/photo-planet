import { describe, expect, it } from 'vitest';
import { UnwrappedLon, angleBetween, clusterItems, fastAtan2, lonDelta, project, unproject, wrapLon, type View } from '../src/planet/geo';
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

describe('UnwrappedLon', () => {
  it('keeps counting across the antimeridian in both directions', () => {
    const u = new UnwrappedLon();
    const seen = [170, 179, -179, -170, 179, 170].map((l) => u.update(l));
    expect(seen).toEqual([170, 179, 181, 190, 179, 170]);
  });

  it('accumulates whole turns', () => {
    const u = new UnwrappedLon();
    let lon = 0;
    for (let i = 0; i < 72 * 3; i++) u.update((lon = wrapLon(lon + 5)));
    expect(u.value).toBeCloseTo(3 * 360);
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

  it('matches the straightforward all-pairs clustering exactly', () => {
    // reference: the original greedy version, checking every cluster in creation order
    const reference = (pts: { lat: number; lon: number; id: string }[], radiusDeg: number) => {
      const cosR = Math.cos((radiusDeg * Math.PI) / 180);
      const vec = (lat: number, lon: number) => {
        const p = (lat * Math.PI) / 180;
        const l = (lon * Math.PI) / 180;
        return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)];
      };
      const seeds: number[][] = [];
      const groups: string[][] = [];
      for (const it of [...pts].sort((a, b) => a.lat - b.lat || a.lon - b.lon)) {
        const v = vec(it.lat, it.lon);
        const k = seeds.findIndex((s) => s[0]! * v[0]! + s[1]! * v[1]! + s[2]! * v[2]! >= cosR);
        if (k >= 0) groups[k]!.push(it.id);
        else (seeds.push(v), groups.push([it.id]));
      }
      return groups.map((g) => g.join()).sort();
    };
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pts = Array.from({ length: 1500 }, (_, i) => {
      // dense blobs, scattered points, and some near the poles and antimeridian
      const kind = i % 5;
      const lat = kind === 4 ? 85 + rnd() * 4.9 : kind === 3 ? (rnd() - 0.5) * 170 : 35 + (rnd() - 0.5) * 2;
      const lon = kind === 2 ? 179.5 + rnd() - 1 + (rnd() < 0.5 ? 0 : -359) : (rnd() - 0.5) * (kind === 3 ? 360 : 4) + (kind === 3 ? 0 : 139);
      return { lat, lon, id: `p${i}` };
    });
    for (const radius of [0.05, 0.3, 2, 9]) {
      expect(clusterItems(pts, radius).map((c) => c.items.map((i) => i.id).join()).sort()).toEqual(reference(pts, radius));
    }
  });

  it('copes with tens of thousands of photos quickly', () => {
    const pts = Array.from({ length: 30000 }, (_, i) => ({ lat: 35 + (i % 173) / 400, lon: 139 + (i % 211) / 300, id: `${i}` }));
    const started = performance.now();
    const clusters = clusterItems(pts, 0.2);
    expect(clusters.reduce((n, c) => n + c.items.length, 0)).toBe(30000);
    expect(performance.now() - started).toBeLessThan(1000);
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
