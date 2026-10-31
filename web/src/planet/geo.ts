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
export function clusterItems<T extends Located>(items: T[], radiusDeg: number): Cluster<T>[] {
  type Building = Cluster<T> & { seed: [number, number, number]; sum: [number, number, number] };
  const clusters: Building[] = [];
  const cosR = Math.cos(radiusDeg * DEG);
  // Stable order so clusters don't reshuffle between refreshes.
  const sorted = [...items].sort((a, b) => a.lat - b.lat || a.lon - b.lon);
  for (const item of sorted) {
    const v = toVec(item.lat, item.lon);
    let home: Building | null = null;
    for (const c of clusters) {
      if (c.seed[0] * v[0] + c.seed[1] * v[1] + c.seed[2] * v[2] >= cosR) {
        home = c;
        break;
      }
    }
    if (!home) {
      home = { lat: item.lat, lon: item.lon, items: [] as T[], seed: v, sum: [0, 0, 0] };
      clusters.push(home);
    }
    home.items.push(item);
    home.sum[0] += v[0];
    home.sum[1] += v[1];
    home.sum[2] += v[2];
  }
  return clusters.map(({ items: members, sum }) => {
    const len = Math.hypot(sum[0], sum[1], sum[2]) || 1;
    return {
      lat: Math.asin(clamp(sum[1] / len, -1, 1)) / DEG,
      lon: Math.atan2(sum[0], sum[2]) / DEG,
      items: members,
    };
  });
}
