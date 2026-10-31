import biomesUrl from './earth-biomes.bin?url';
import { decodeRle } from './earth-format';

export interface EarthMap {
  width: number;
  height: number;
  data: Uint8Array;
}

async function load(url: string): Promise<EarthMap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load ${url}`);
  return decodeRle(new Uint8Array(await res.arrayBuffer()));
}

export const loadBiomes = () => load(biomesUrl);
