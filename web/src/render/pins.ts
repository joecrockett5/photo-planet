import type { MediaItem } from '../api';
import { clusterItems, prepareClusters, project, type Cluster, type ClusterInput, type View } from '../planet/geo';
import { C } from './palette';
import { plot } from './pixels';

export type PlacedItem = MediaItem & { lat: number; lon: number };

/** '.' clear, 'o' outline, 'P' body, 'L' blinking light. The bottom pixel is the exact spot. */
const SINGLE = ['.ooo.', 'oPPPo', 'oPLPo', 'oPPPo', '.oPo.', '..o..'];
const CLUSTER = ['..ooo..', '.oPPPo.', 'oPPLPPo', 'oPLLLPo', 'oPPLPPo', '.oPPPo.', '..oPo..', '...o...'];

/** On-screen cluster pin positions (art px), rebuilt every frame. */
export interface PinHit {
  cluster: Cluster<PlacedItem>;
  x: number; // tip
  y: number;
  w: number;
  h: number;
}

/** Pins live on the canvas so they share the planet's pixels exactly. */
export class PinLayer {
  private items: PlacedItem[] = [];
  private prepared: ClusterInput<PlacedItem> | null = null;
  private signature = '';
  /** Clusters per zoom level (cleared when the items change). */
  private cache = new Map<number, Cluster<PlacedItem>[]>();
  hits: PinHit[] = [];
  /** The cluster whose gallery is open; drawn lit. */
  selected: Set<string> | null = null;
  hovered: PinHit | null = null;
  /** A temporary marker (e.g. while placing an item). */
  ghost: { lat: number; lon: number } | null = null;

  /** Returns false if nothing that affects the pins changed (e.g. a status poll). */
  setItems(items: PlacedItem[]): boolean {
    const signature = pinSignature(items);
    // keep the newest item objects (for galleries/labels) either way
    const sameLayout = signature === this.signature;
    if (sameLayout) {
      const byId = new Map(items.map((i) => [i.id, i]));
      const fresh = (list: PlacedItem[]) => {
        for (let k = 0; k < list.length; k++) list[k] = byId.get(list[k]!.id) ?? list[k]!;
      };
      for (const clusters of this.cache.values()) for (const c of clusters) fresh(c.items);
      if (this.prepared) fresh(this.prepared.sorted);
    } else {
      this.cache.clear();
      this.prepared = null;
    }
    this.items = items;
    this.signature = signature;
    return !sameLayout;
  }

  /**
   * Pins closer than ~9 art px on screen merge; that's an angle that depends
   * on zoom. Zoom is quantised to quarter-octave levels, so a zoom gesture
   * re-clusters every ~19% rather than every frame (and pins don't flicker
   * between groupings), and each level's result is kept.
   */
  private clustersFor(r: number): Cluster<PlacedItem>[] {
    const level = Math.round(Math.log2(r) * 4);
    let clusters = this.cache.get(level);
    if (!clusters) {
      const levelR = 2 ** (level / 4);
      this.prepared ??= prepareClusters(this.items);
      clusters = clusterItems(this.prepared, (9 / levelR) * (180 / Math.PI));
      if (this.cache.size > 40) this.cache.clear();
      this.cache.set(level, clusters);
    }
    return clusters;
  }

  draw(buf: Uint32Array, w: number, h: number, view: View, t: number, motion: boolean): void {
    const hits: PinHit[] = [];
    for (const cluster of this.clustersFor(view.r)) {
      const p = project(view, cluster.lat, cluster.lon);
      if (p.z < 0.12) continue; // far side, or too close to the limb to read
      hits.push({ cluster, x: Math.floor(p.x), y: Math.floor(p.y), w: 0, h: 0 });
    }
    // back to front: pins lower on screen are nearer the viewer
    hits.sort((a, b) => a.y - b.y);
    for (const hit of hits) {
      const sprite = hit.cluster.items.length > 1 ? CLUSTER : SINGLE;
      hit.w = sprite[0]!.length;
      hit.h = sprite.length;
      const id = hit.cluster.items[0]!.id;
      const isSelected = this.selected !== null && hit.cluster.items.some((i) => this.selected!.has(i.id));
      // stepped blink with a per-pin phase: light on 3 beats of 4
      const phase = (id.charCodeAt(0) + id.charCodeAt(1) * 7) % 4;
      const lightOn = !motion || isSelected || (Math.floor(t * 2.5) + phase) % 4 !== 0;
      const body = isSelected || hit === this.hovered ? C.pinLight : C.pin;
      const light = isSelected ? C.pin : lightOn ? C.pinLight : C.pinDark;
      this.blit(buf, w, h, sprite, hit.x, hit.y, body, light);
    }
    if (this.ghost) {
      const p = project(view, this.ghost.lat, this.ghost.lon);
      if (p.z > 0) {
        const on = !motion || Math.floor(t * 4) % 2 === 0;
        this.blit(buf, w, h, SINGLE, Math.floor(p.x), Math.floor(p.y), on ? C.pinLight : C.pin, C.pin);
      }
    }
    this.hits = hits;
  }

  private blit(buf: Uint32Array, w: number, h: number, sprite: readonly string[], tipX: number, tipY: number, body: number, light: number) {
    const sw = sprite[0]!.length;
    const ox = tipX - (sw >> 1);
    const oy = tipY - sprite.length + 1;
    for (let y = 0; y < sprite.length; y++) {
      const row = sprite[y]!;
      for (let x = 0; x < sw; x++) {
        const ch = row[x];
        if (ch === '.') continue;
        plot(buf, w, h, ox + x, oy + y, ch === 'o' ? C.space : ch === 'L' ? light : ch === 'P' ? body : C.pinDark);
      }
    }
  }

  /** The pin under an art-pixel point, with `slop` art px of forgiveness for fingers. */
  hitTest(x: number, y: number, slop: number): PinHit | null {
    let best: PinHit | null = null;
    let bestD = Infinity;
    for (const hit of this.hits) {
      const left = hit.x - (hit.w >> 1) - slop;
      const right = hit.x + (hit.w >> 1) + 1 + slop;
      const top = hit.y - hit.h + 1 - slop;
      const bottom = hit.y + 1 + slop;
      if (x < left || x > right || y < top || y > bottom) continue;
      const d = Math.hypot(x - (hit.x + 0.5), y - (hit.y - hit.h / 2));
      // later (nearer) pins win ties
      if (d <= bestD) {
        best = hit;
        bestD = d;
      }
    }
    return best;
  }
}

/** What pins depend on: which items there are and where they are. */
function pinSignature(items: PlacedItem[]): string {
  let s = '';
  for (const i of items) s += `${i.id}:${i.lat},${i.lon};`;
  return s;
}
