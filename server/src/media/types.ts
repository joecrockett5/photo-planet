export type Kind = 'photo' | 'video';
export type Status = 'processing' | 'ready' | 'failed';
export type LocationSource = 'exif' | 'manual';

/** A row of the `media` table. Paths are relative to DATA_DIR. */
export interface MediaRow {
  id: string;
  original_name: string;
  mime: string;
  kind: Kind;
  size: number;
  sha256: string;
  lat: number | null;
  lon: number | null;
  location_source: LocationSource | null;
  taken_at: string | null;
  uploaded_at: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  status: Status;
  error: string | null;
  original_path: string;
  thumb_path: string | null;
  display_path: string | null;
}

/** What the API returns for an item. */
export interface MediaItem {
  id: string;
  kind: Kind;
  name: string;
  mime: string;
  size: number;
  lat: number | null;
  lon: number | null;
  locationSource: LocationSource | null;
  takenAt: string | null;
  uploadedAt: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  status: Status;
  /** Why processing failed, if it did. */
  error: string | null;
  thumbUrl: string | null;
  displayUrl: string;
  originalUrl: string;
}

export function toItem(row: MediaRow): MediaItem {
  // `v` busts caches when derived files appear later.
  const v = row.status === 'processing' ? '' : `?v=${row.status[0]}`;
  return {
    id: row.id,
    kind: row.kind,
    name: row.original_name,
    mime: row.mime,
    size: row.size,
    lat: row.lat,
    lon: row.lon,
    locationSource: row.location_source,
    takenAt: row.taken_at,
    uploadedAt: row.uploaded_at,
    width: row.width,
    height: row.height,
    duration: row.duration,
    status: row.status,
    error: row.status === 'failed' ? row.error : null,
    thumbUrl: row.thumb_path ? `/media/${row.id}/thumb${v}` : null,
    displayUrl: `/media/${row.id}/display${v}`,
    originalUrl: `/media/${row.id}/original`,
  };
}

/** Accepted upload types, keyed by lower-case extension. */
export const ACCEPTED: Record<string, { kind: Kind; mime: string }> = {
  jpg: { kind: 'photo', mime: 'image/jpeg' },
  jpeg: { kind: 'photo', mime: 'image/jpeg' },
  png: { kind: 'photo', mime: 'image/png' },
  webp: { kind: 'photo', mime: 'image/webp' },
  heic: { kind: 'photo', mime: 'image/heic' },
  heif: { kind: 'photo', mime: 'image/heif' },
  mp4: { kind: 'video', mime: 'video/mp4' },
  m4v: { kind: 'video', mime: 'video/mp4' },
  mov: { kind: 'video', mime: 'video/quicktime' },
  webm: { kind: 'video', mime: 'video/webm' },
};

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

/** Work out the stored extension from the filename, falling back to the mime type. */
export function acceptedType(filename: string, mimetype: string): { ext: string; kind: Kind; mime: string } | null {
  const fromName = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  const ext = fromName && ACCEPTED[fromName] ? fromName : MIME_TO_EXT[mimetype.toLowerCase()];
  if (!ext) return null;
  const t = ACCEPTED[ext]!;
  return { ext: ext === 'jpeg' ? 'jpg' : ext, kind: t.kind, mime: t.mime };
}
