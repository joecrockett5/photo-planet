import type { Kind } from './types.js';

export interface Metadata {
  lat: number | null;
  lon: number | null;
  /** ISO 8601. Includes an offset or `Z` when the file says so; otherwise local wall-clock time without one. */
  takenAt: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
}

export const EMPTY_METADATA: Metadata = { lat: null, lon: null, takenAt: null, width: null, height: null, duration: null };

export async function extractMetadata(_file: string, _kind: Kind): Promise<Metadata> {
  return { ...EMPTY_METADATA };
}
