import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { hasTool, run } from '../exec.js';
import type { Storage } from '../storage.js';
import { ffprobe, type Probe } from './metadata.js';
import type { MediaRow } from './types.js';

export const THUMB_SIZE = 400;
const MAX_VIDEO_EDGE = 1920;

export class MissingToolError extends Error {}

/** Fields to write back to the row once derived files are made. */
export type DerivedFields = Partial<Pick<MediaRow, 'thumb_path' | 'display_path' | 'width' | 'height' | 'duration'>>;

/**
 * Make the thumbnail and, where browsers can't show the original, a display
 * version. Partial results are reported through `save` as they appear, so a
 * failed transcode still leaves a usable thumbnail.
 */
export async function deriveFiles(
  row: MediaRow,
  storage: Storage,
  save: (f: DerivedFields) => void,
  signal?: AbortSignal,
): Promise<void> {
  await mkdir(storage.derivedDirFor(row.id), { recursive: true });
  if (row.kind === 'photo') await derivePhoto(row, storage, save, signal);
  else await deriveVideo(row, storage, save, signal);
}

// ---------------------------------------------------------------- photos

const HEIF_MIMES = new Set(['image/heic', 'image/heif']);

async function derivePhoto(row: MediaRow, storage: Storage, save: (f: DerivedFields) => void, signal?: AbortSignal) {
  let source = storage.abs(row.original_path);

  if (HEIF_MIMES.has(row.mime)) {
    // sharp's prebuilt libvips can't decode HEVC-coded HEIF; heif-convert can.
    if (!(await hasTool('heif-convert', '--version'))) {
      throw new MissingToolError('heif-convert is not installed, so this HEIC photo cannot be shown');
    }
    const displayRel = storage.derivedRel(row.id, 'display.jpg');
    await heifToJpeg(source, storage.abs(displayRel), signal);
    save({ display_path: displayRel });
    source = storage.abs(displayRel);
  }

  const image = sharp(source, { failOn: 'none' });
  const meta = await image.metadata();
  const swap = (meta.orientation ?? 1) >= 5;
  const width = swap ? meta.height : meta.width;
  const height = swap ? meta.width : meta.height;

  const thumbRel = storage.derivedRel(row.id, 'thumb.webp');
  await sharp(source, { failOn: 'none' })
    .rotate()
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toFile(storage.abs(thumbRel));
  save({ thumb_path: thumbRel, width: width ?? null, height: height ?? null });
}

async function heifToJpeg(input: string, output: string, signal?: AbortSignal) {
  await run('heif-convert', ['-q', '90', input, output], { timeoutMs: 120_000, signal });
  if (await exists(output)) return;
  // Files with several top-level images come out as display-1.jpg, display-2.jpg...
  const dir = path.dirname(output);
  const base = path.basename(output, '.jpg');
  const numbered = (await readdir(dir)).filter((f) => f.startsWith(`${base}-`) && f.endsWith('.jpg')).sort();
  if (numbered.length === 0) throw new Error('heif-convert produced no image');
  await rename(path.join(dir, numbered[0]!), output);
  for (const extra of numbered.slice(1)) await rm(path.join(dir, extra), { force: true });
}

// ---------------------------------------------------------------- videos

const PLAYABLE_VIDEO: Record<string, Set<string>> = {
  'video/mp4': new Set(['h264', 'av1', 'vp9']),
  'video/webm': new Set(['vp8', 'vp9', 'av1']),
};
const PLAYABLE_AUDIO: Record<string, Set<string>> = {
  'video/mp4': new Set(['aac', 'mp3', 'opus']),
  'video/webm': new Set(['opus', 'vorbis']),
};

type VideoPlan = 'original' | 'remux' | 'transcode';

/** What it takes to make a video play in every major browser. */
export function planVideo(mime: string, probe: Probe): VideoPlan {
  const v = probe.streams?.find((s) => s.codec_type === 'video')?.codec_name ?? '';
  const a = probe.streams?.find((s) => s.codec_type === 'audio')?.codec_name;
  const okAudio = (container: string) => a === undefined || PLAYABLE_AUDIO[container]!.has(a);
  if (PLAYABLE_VIDEO[mime]?.has(v) && okAudio(mime)) return 'original';
  // H.264 + AAC in a .mov just needs a new container.
  if (v === 'h264' && (a === undefined || a === 'aac' || a === 'mp3')) return 'remux';
  return 'transcode';
}

async function deriveVideo(row: MediaRow, storage: Storage, save: (f: DerivedFields) => void, signal?: AbortSignal) {
  if (!(await hasTool('ffmpeg')) || !(await hasTool('ffprobe'))) {
    throw new MissingToolError('ffmpeg is not installed, so no video thumbnail or browser version was made');
  }
  const input = storage.abs(row.original_path);
  const probe = await ffprobe(input);
  if (!probe) throw new Error('could not read video');
  const duration = Number(probe.format?.duration);
  const dir = storage.derivedDirFor(row.id);

  // Poster frame ~1s in (or halfway through very short clips) → thumbnail.
  const at = Number.isFinite(duration) && duration > 0 ? Math.min(1, duration / 2) : 0;
  const poster = path.join(dir, 'poster.jpg');
  await run('ffmpeg', ['-v', 'error', '-y', '-ss', at.toFixed(2), '-i', input, '-frames:v', '1', '-q:v', '3', poster], {
    timeoutMs: 120_000,
    signal,
  }).catch(() =>
    // Seeking can fail on odd files; the very first frame always exists.
    run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-frames:v', '1', '-q:v', '3', poster], { timeoutMs: 120_000, signal }),
  );
  const thumbRel = storage.derivedRel(row.id, 'thumb.webp');
  await sharp(poster)
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toFile(storage.abs(thumbRel));
  await rm(poster, { force: true });
  save({ thumb_path: thumbRel });

  const plan = planVideo(row.mime, probe);
  if (plan === 'original') return;
  const displayRel = storage.derivedRel(row.id, 'display.mp4');
  const out = storage.abs(displayRel);
  const tmp = `${out}.part.mp4`;
  if (plan === 'remux') {
    await run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-movflags', '+faststart', tmp], { signal });
  } else {
    await transcode(input, tmp, probe, signal);
  }
  await rename(tmp, out);
  save({ display_path: displayRel });
}

async function transcode(input: string, output: string, probe: Probe, signal?: AbortSignal) {
  const video = probe.streams?.find((s) => s.codec_type === 'video') as { color_transfer?: string } | undefined;
  const hdr = video?.color_transfer === 'arib-std-b67' || video?.color_transfer === 'smpte2084';
  const scale = `scale=w='min(${MAX_VIDEO_EDGE},iw)':h='min(${MAX_VIDEO_EDGE},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
  // iPhone HDR (HLG) video looks washed out as 8-bit SDR unless tone-mapped.
  const tonemap =
    'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv';
  const args = (vf: string) => [
    '-v', 'error', '-y', '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', `${vf},format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-movflags', '+faststart', output,
  ];
  try {
    await run('ffmpeg', args(hdr ? `${tonemap},${scale}` : scale), { signal });
  } catch (err) {
    if (!hdr || signal?.aborted) throw err;
    await run('ffmpeg', args(scale), { signal }); // no zscale in this ffmpeg build: plain conversion
  }
}

async function exists(file: string) {
  return stat(file).then(
    () => true,
    () => false,
  );
}
