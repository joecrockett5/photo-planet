import { open, readFile } from 'node:fs/promises';
import exifr from 'exifr';
import { hasTool, run } from '../exec.js';
import { findExifBlock } from './exif-blocks.js';
import { parseIso6709 } from './iso6709.js';
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

export async function extractMetadata(file: string, kind: Kind): Promise<Metadata> {
  try {
    return kind === 'photo' ? await photoMetadata(file) : await videoMetadata(file);
  } catch (err) {
    console.warn(`[photo-planet] could not read metadata from ${file}: ${(err as Error).message}`);
    return { ...EMPTY_METADATA };
  }
}

// ---------------------------------------------------------------- photos

const EXIFR_OPTIONS = {
  tiff: true,
  exif: true,
  gps: true,
  ifd1: false,
  xmp: false,
  icc: false,
  iptc: false,
  jfif: false,
  ihdr: false,
  reviveValues: false,
  translateValues: false,
  translateKeys: true,
  mergeOutput: true,
} as const;

type ExifData = Record<string, unknown> | undefined;

export async function photoMetadata(file: string): Promise<Metadata> {
  let data: ExifData;
  try {
    data = (await exifr.parse(file, EXIFR_OPTIONS)) as ExifData;
  } catch {
    data = undefined; // e.g. "Unknown file format" for WebP
  }
  if (!hasUsefulExif(data)) {
    const block = await readExifBlock(file);
    if (block) data = ((await exifr.parse(block, EXIFR_OPTIONS).catch(() => undefined)) as ExifData) ?? data;
  }
  return { ...EMPTY_METADATA, ...gpsFrom(data), takenAt: exifDate(data) };
}

function hasUsefulExif(d: ExifData): boolean {
  return !!d && (typeof d.latitude === 'number' || typeof d.DateTimeOriginal === 'string');
}

async function readExifBlock(file: string): Promise<Buffer | null> {
  // Only HEIF and WebP need this; peek at the header before reading the whole file.
  const fh = await open(file, 'r');
  try {
    const head = Buffer.alloc(12);
    await fh.read(head, 0, 12, 0);
    const isWebp = head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP';
    const isHeif = head.toString('latin1', 4, 8) === 'ftyp';
    if (!isWebp && !isHeif) return null;
  } finally {
    await fh.close();
  }
  return findExifBlock(await readFile(file));
}

function gpsFrom(d: ExifData): { lat: number | null; lon: number | null } {
  const lat = d?.latitude;
  const lon = d?.longitude;
  return validLatLon(lat, lon) ? { lat, lon: lon as number } : { lat: null, lon: null };
}

export function validLatLon(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    // Cameras without a fix sometimes write 0,0 ("Null Island").
    !(lat === 0 && lon === 0)
  );
}

function exifDate(d: ExifData): string | null {
  const candidates: [unknown, unknown][] = [
    [d?.DateTimeOriginal, d?.OffsetTimeOriginal],
    [d?.CreateDate, d?.OffsetTimeDigitized],
  ];
  for (const [value, offset] of candidates) {
    const iso = parseExifDate(value, offset);
    if (iso) return iso;
  }
  return null;
}

/** `2023:06:14 18:32:05` (+ optional `+01:00`) → `2023-06-14T18:32:05+01:00`. */
export function parseExifDate(value: unknown, offset?: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, da, h, mi, s] = m;
  if (!validDateParts(y!, mo!, da!)) return null;
  const tz = typeof offset === 'string' && /^[+-]\d{2}:\d{2}$/.test(offset.trim()) ? offset.trim() : '';
  return `${y}-${mo}-${da}T${h}:${mi}:${s}${tz}`;
}

function validDateParts(y: string, mo: string, d: string): boolean {
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  // 1904/1970 are the QuickTime/Unix zero dates that devices write when they don't know.
  return year > 1970 && year < 2200 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

// ---------------------------------------------------------------- videos

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number }[];
}

export interface Probe {
  format?: { duration?: string; format_name?: string; tags?: Record<string, string> };
  streams?: ProbeStream[];
}

export async function ffprobe(file: string): Promise<Probe | null> {
  if (!(await hasTool('ffprobe'))) return null;
  const { stdout } = await run('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file], {
    timeoutMs: 60_000,
  });
  return JSON.parse(stdout) as Probe;
}

export async function videoMetadata(file: string): Promise<Metadata> {
  const probe = await ffprobe(file);
  return probe ? metadataFromProbe(probe) : { ...EMPTY_METADATA };
}

/** Case-insensitive tag lookup across the container and its streams. */
function tag(probe: Probe, ...names: string[]): string | undefined {
  const sources = [probe.format?.tags, ...(probe.streams ?? []).map((s) => s.tags)];
  for (const name of names) {
    for (const tags of sources) {
      if (!tags) continue;
      const key = Object.keys(tags).find((k) => k.toLowerCase() === name.toLowerCase());
      if (key && tags[key]) return tags[key];
    }
  }
  return undefined;
}

export function metadataFromProbe(probe: Probe): Metadata {
  const point = parseIso6709(tag(probe, 'com.apple.quicktime.location.ISO6709', 'location', 'location-eng'));
  const video = probe.streams?.find((s) => s.codec_type === 'video');
  let width = video?.width ?? null;
  let height = video?.height ?? null;
  if (width && height && isQuarterTurn(video)) [width, height] = [height, width];
  const duration = Number(probe.format?.duration);
  return {
    lat: point && validLatLon(point.lat, point.lon) ? point.lat : null,
    lon: point && validLatLon(point.lat, point.lon) ? point.lon : null,
    takenAt: videoDate(probe),
    width,
    height,
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
  };
}

export function videoRotation(stream: ProbeStream | undefined): number {
  const fromSide = stream?.side_data_list?.find((s) => typeof s.rotation === 'number')?.rotation;
  const fromTag = Number(stream?.tags?.rotate);
  const r = fromSide ?? (Number.isFinite(fromTag) ? fromTag : 0);
  return ((Math.round(r) % 360) + 360) % 360;
}

function isQuarterTurn(stream: ProbeStream | undefined): boolean {
  const r = videoRotation(stream);
  return r === 90 || r === 270;
}

function videoDate(probe: Probe): string | null {
  // iPhone: local time with offset, e.g. 2022-07-04T21:15:00-0400.
  const local = tag(probe, 'com.apple.quicktime.creationdate');
  const m = local && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?/.exec(local);
  if (m && validDateParts(m[1]!, m[2]!, m[3]!)) {
    const tz = m[7] ? (m[7] === 'Z' ? 'Z' : `${m[7].slice(0, 3)}:${m[7].slice(-2)}`) : '';
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${tz}`;
  }
  // Everyone else: UTC creation_time.
  const utc = tag(probe, 'creation_time');
  const u = utc && /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(utc);
  if (u && validDateParts(u[1]!, u[2]!, u[3]!)) return `${u[1]}-${u[2]}-${u[3]}T${u[4]}:${u[5]}:${u[6]}Z`;
  return null;
}
