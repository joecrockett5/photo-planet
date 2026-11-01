import { describe, expect, it } from 'vitest';
import { PlanetRenderer } from '../src/render/planet';

const W = 1024;
const H = 512;
const at = (grid: Uint8Array, lat: number, lon: number) =>
  grid[Math.min(H - 1, Math.floor(((90 - lat) / 180) * H)) * W + Math.min(W - 1, Math.floor(((lon + 180) / 360) * W))]!;

describe('cloud clearings over photos', () => {
  it('is fully clear at a photo and fades to nothing a few degrees away', () => {
    const grid = PlanetRenderer.clearingsFor([{ lat: 34.69, lon: 135.5 }]);
    expect(at(grid, 34.69, 135.5)).toBeGreaterThan(220);
    expect(at(grid, 34.69 + 2, 135.5)).toBeGreaterThan(0);
    expect(at(grid, 34.69 + 2, 135.5)).toBeLessThan(at(grid, 34.69, 135.5));
    expect(at(grid, 34.69 + 6, 135.5)).toBe(0);
    expect(at(grid, 0, 0)).toBe(0);
  });

  it('wraps across the antimeridian and widens towards the poles', () => {
    const grid = PlanetRenderer.clearingsFor([{ lat: -17, lon: 179.5 }, { lat: 70, lon: 0 }]);
    expect(at(grid, -17, -179.5)).toBeGreaterThan(0);
    // at 70°N a degree of longitude is short, so the patch spans more of them
    expect(at(grid, 70, 8)).toBeGreaterThan(0);
  });
});
