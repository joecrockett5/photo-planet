import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Storage } from '../storage.js';
import type { MediaRepo } from './repo.js';
import { acceptedType, type MediaRow } from './types.js';
import type { Metadata } from './metadata.js';

export class UploadError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function newId(): string {
  return randomBytes(9).toString('base64url');
}

export interface IngestDeps {
  storage: Storage;
  repo: MediaRepo;
  extractMetadata: (file: string, kind: MediaRow['kind']) => Promise<Metadata>;
  onIngested: (row: MediaRow) => void;
}

export interface IngestResult {
  row: MediaRow;
  duplicate: boolean;
}

/**
 * Stream one uploaded file to disk untouched, dedupe by content hash, read its
 * metadata and record it. Derived files are made later by the job queue.
 */
export async function ingest(
  deps: IngestDeps,
  file: { filename: string; mimetype: string; stream: Readable & { truncated?: boolean } },
): Promise<IngestResult> {
  const type = acceptedType(file.filename, file.mimetype);
  if (!type) {
    file.stream.resume();
    throw new UploadError(415, 'unsupported file type');
  }

  const id = newId();
  const tmp = path.join(deps.storage.tmpDir, `${id}.${type.ext}.part`);
  const hash = createHash('sha256');
  let size = 0;
  file.stream.on('data', (chunk: Buffer) => {
    hash.update(chunk);
    size += chunk.length;
  });

  try {
    await pipeline(file.stream, createWriteStream(tmp));
    if (file.stream.truncated) throw new UploadError(413, 'file too large');
    if (size === 0) throw new UploadError(400, 'empty file');
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }

  const sha256 = hash.digest('hex');
  const existing = deps.repo.findBySha(sha256);
  if (existing) {
    await rm(tmp, { force: true });
    return { row: existing, duplicate: true };
  }

  const originalRel = deps.storage.originalRel(id, type.ext);
  await rename(tmp, deps.storage.abs(originalRel));

  const meta = await deps.extractMetadata(deps.storage.abs(originalRel), type.kind);
  const hasLocation = meta.lat !== null && meta.lon !== null;
  const row = deps.repo.insert({
    id,
    original_name: path.basename(file.filename).slice(0, 255) || `upload.${type.ext}`,
    mime: type.mime,
    kind: type.kind,
    size,
    sha256,
    lat: hasLocation ? meta.lat : null,
    lon: hasLocation ? meta.lon : null,
    location_source: hasLocation ? 'exif' : null,
    taken_at: meta.takenAt,
    uploaded_at: new Date().toISOString(),
    width: meta.width,
    height: meta.height,
    duration: meta.duration,
    original_path: originalRel,
  });
  deps.onIngested(row);
  return { row: deps.repo.get(id) ?? row, duplicate: false };
}
