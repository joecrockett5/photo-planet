/** Sphere maths shared by the renderer, pins and input. Angles in degrees unless noted. */

export const DEG = Math.PI / 180;

export interface View {
  /** lat/lon at the centre of the visible disc */
  lat: number;
  lon: number;
  /** disc centre and radius, in art pixels */
  cx: number;
  cy: number;
  r: number;
}

/**
 * atan2 via a minimax polynomial: max error ~0.012°, far below one map texel
 * (0.18°), and about twice as fast as Math.atan2 in the per-pixel loop.
 */
export function fastAtan2(y: number, x: number): number {
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  const mx = ax > ay ? ax : ay;
  if (mx === 0) return 0;
  const a = (ax > ay ? ay : ax) / mx;
  const s = a * a;
  let r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a;
  if (ay > ax) r = 1.57079637 - r;
  if (x < 0) r = 3.14159274 - r;
  return y < 0 ? -r : r;
}

export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Unit vector for a lat/lon; lon 0 faces +z, north is +y. */
export function toVec(lat: number, lon: number): [number, number, number] {
  const p = lat * DEG;
  const l = lon * DEG;
  return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)];
}

/**
 * Project lat/lon to art-pixel screen coordinates. `z` > 0 means on the
 * visible hemisphere (z is the depth towards the viewer, 0..1).
 */
export function project(view: View, lat: number, lon: number): { x: number; y: number; z: number } {
  const [x, y, z] = toVec(lat, lon);
  const sl = Math.sin(view.lon * DEG);
  const cl = Math.cos(view.lon * DEG);
  const sp = Math.sin(view.lat * DEG);
  const cp = Math.cos(view.lat * DEG);
  const x1 = x * cl - z * sl;
  const z1 = x * sl + z * cl;
  const y2 = y * cp - z1 * sp;
  const z2 = y * sp + z1 * cp;
  return { x: view.cx + x1 * view.r, y: view.cy - y2 * view.r, z: z2 };
}

/** Screen point → lat/lon on the sphere, or null if it misses the disc. */
export function unproject(view: View, sx: number, sy: number): { lat: number; lon: number } | null {
  const nx = (sx - view.cx) / view.r;
  const ny = -(sy - view.cy) / view.r;
  const r2 = nx * nx + ny * ny;
  if (r2 > 1) return null;
  const nz = Math.sqrt(1 - r2);
  const [wx, wy, wz] = viewToWorld(view, nx, ny, nz);
  return { lat: Math.asin(clamp(wy, -1, 1)) / DEG, lon: wrapLon(Math.atan2(wx, wz) / DEG) };
}

export function viewToWorld(view: View, nx: number, ny: number, nz: number): [number, number, number] {
  const sp = Math.sin(view.lat * DEG);
  const cp = Math.cos(view.lat * DEG);
  const sl = Math.sin(view.lon * DEG);
  const cl = Math.cos(view.lon * DEG);
  const y1 = ny * cp + nz * sp;
  const z1 = -ny * sp + nz * cp;
  return [nx * cl + z1 * sl, y1, -nx * sl + z1 * cl];
}

/** Great-circle angle between two points, in degrees. */
export function angleBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a = toVec(lat1, lon1);
  const b = toVec(lat2, lon2);
  return Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1)) / DEG;
}

/** Shortest signed longitude difference from a to b, in (-180, 180]. */
export function lonDelta(a: number, b: number): number {
  return wrapLon(b - a);
}

/**
 * Follows a wrapped longitude (-180..180) and reports a continuous one that
 * never jumps: crossing the antimeridian keeps counting (179 → 181, not -179).
 * Used for the starfield's parallax, which would otherwise leap by 360° worth
 * of offset every time the globe spins past ±180°.
 */
export class UnwrappedLon {
  private last: number | null = null;
  value = 0;

  update(lon: number): number {
    if (this.last === null) this.value = lon;
    else this.value += lonDelta(this.last, lon);
    this.last = lon;
    return this.value;
  }
}

export interface Located {
  lat: number;
  lon: number;
}

export interface Cluster<T extends Located> {
  lat: number;
  lon: number;
  items: T[];
}

/**
 * Greedy clustering on the sphere: items within `radiusDeg` of a cluster's
 * first member join it. Clusters are stable while the planet rotates (they
 * only change with zoom or data). The cluster position is the mean of its
 * members.
 */
/** Items in clustering order with their unit vectors: reusable across zoom levels. */
export interface ClusterInput<T extends Located> {
  sorted: T[];
  vecs: Float64Array; // x, y, z per sorted item
}

export function prepareClusters<T extends Located>(items: T[]): ClusterInput<T> {
  // Stable order so clusters don't reshuffle between refreshes.
  const sorted = [...items].sort((a, b) => a.lat - b.lat || a.lon - b.lon);
  const vecs = new Float64Array(sorted.length * 3);
  sorted.forEach((item, i) => vecs.set(toVec(item.lat, item.lon), i * 3));
  return { sorted, vecs };
}

export function clusterItems<T extends Located>(items: T[] | ClusterInput<T>, radiusDeg: number): Cluster<T>[] {
  const { sorted, vecs } = Array.isArray(items) ? prepareClusters(items) : items;
  type Building = { seed: number; items: T[]; sx: number; sy: number; sz: number; index: number };
  const clusters: Building[] = [];
  const cosR = Math.cos(radiusDeg * DEG);
  // Spatial hash over unit vectors: a cluster seed within the radius of a
  // point is always in the point's cell or a neighbouring one (cells are as
  // wide as the chord for the radius), so each item checks a handful of
  // clusters instead of all of them. Same result as checking every cluster in
  // creation order: the earliest-created match wins.
  const cell = Math.max(1e-4, 2 * Math.sin((radiusDeg * DEG) / 2));
  const grid = new Map<number, Building[]>();
  const SPAN = 1 << 13; // cell indices fit easily: |index| <= 1 / cell
  const key = (ix: number, iy: number, iz: number) => ((ix + SPAN) * 2 * SPAN + (iy + SPAN)) * 2 * SPAN + (iz + SPAN);
  for (let n = 0; n < sorted.length; n++) {
    const vx = vecs[n * 3]!;
    const vy = vecs[n * 3 + 1]!;
    const vz = vecs[n * 3 + 2]!;
    const ix = Math.floor(vx / cell);
    const iy = Math.floor(vy / cell);
    const iz = Math.floor(vz / cell);
    let home: Building | null = null;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(key(ix + dx, iy + dy, iz + dz));
          if (!bucket) continue;
          for (const c of bucket) {
            if (home && c.index >= home.index) continue;
            const s0 = c.seed * 3;
            if (vecs[s0]! * vx + vecs[s0 + 1]! * vy + vecs[s0 + 2]! * vz >= cosR) home = c;
          }
        }
      }
    }
    if (!home) {
      home = { seed: n, items: [], sx: 0, sy: 0, sz: 0, index: clusters.length };
      clusters.push(home);
      const k = key(ix, iy, iz);
      const bucket = grid.get(k);
      if (bucket) bucket.push(home);
      else grid.set(k, [home]);
    }
    home.items.push(sorted[n]!);
    home.sx += vx;
    home.sy += vy;
    home.sz += vz;
  }
  return clusters.map(({ items: members, sx, sy, sz }) => {
    const len = Math.hypot(sx, sy, sz) || 1;
    return {
      lat: Math.asin(clamp(sy / len, -1, 1)) / DEG,
      lon: Math.atan2(sx, sz) / DEG,
      items: members,
    };
  });
}
