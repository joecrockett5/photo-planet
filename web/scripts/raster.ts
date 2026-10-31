/**
 * Rasterise lon/lat polygons (GeoJSON-style, as from world-atlas) onto an
 * equirectangular grid. Shared by the map generators (dev-time scripts only).
 */
export type Ring = [number, number][];
export type Polygon = Ring[];

export function polygonsOf(geom: { type: string; coordinates: unknown }): Polygon[] {
  if (geom.type === 'Polygon') return [geom.coordinates as Polygon];
  if (geom.type === 'MultiPolygon') return geom.coordinates as Polygon[];
  return [];
}

/**
 * Rings that cross the antimeridian (lon jumps by ~360) are unwrapped into a
 * continuous ring and filled three times, shifted by -360/0/+360. Rings that
 * run along a pole edge (Antarctica) are already closed in plain lon/lat.
 */
export function fillPolygon(grid: Uint8Array, W: number, H: number, poly: Polygon, value: number): void {
  const touchesPole = poly.some((ring) => ring.some(([, lat]) => Math.abs(lat) > 89.9));
  const wraps = poly.some((ring) => ring.some(([lon], i) => i > 0 && Math.abs(lon - ring[i - 1]![0]) > 180));
  if (!wraps || touchesPole) return fillPlanar(grid, W, H, poly, value);
  const unwrapped = poly.map((ring) => {
    const out: Ring = [];
    let offset = 0;
    ring.forEach(([lon, lat], i) => {
      if (i > 0) {
        const prev = ring[i - 1]![0];
        if (lon - prev > 180) offset -= 360;
        else if (prev - lon > 180) offset += 360;
      }
      out.push([lon + offset, lat]);
    });
    return out;
  });
  for (const shift of [-360, 0, 360]) {
    fillPlanar(grid, W, H, unwrapped.map((r) => r.map(([x, y]) => [x + shift, y] as [number, number])), value);
  }
}

/** Even-odd scanline fill of one polygon (outer ring + holes) at texel centres. */
function fillPlanar(grid: Uint8Array, W: number, H: number, poly: Polygon, value: number) {
  let minY = H;
  let maxY = 0;
  for (const ring of poly)
    for (const [, lat] of ring) {
      const y = ((90 - lat) / 180) * H;
      minY = Math.min(minY, Math.floor(y));
      maxY = Math.max(maxY, Math.ceil(y));
    }
  for (let y = Math.max(0, minY); y <= Math.min(H - 1, maxY); y++) {
    const lat = 90 - ((y + 0.5) / H) * 180;
    const xs: number[] = [];
    for (const ring of poly) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x1, y1] = ring[j]!;
        const [x2, y2] = ring[i]!;
        if (y1 > lat !== y2 > lat) xs.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.ceil(((xs[k]! + 180) / 360) * W - 0.5);
      const b = Math.floor(((xs[k + 1]! + 180) / 360) * W - 0.5);
      for (let x = Math.max(0, a); x <= Math.min(W - 1, b); x++) grid[y * W + x] = value;
    }
  }
}
