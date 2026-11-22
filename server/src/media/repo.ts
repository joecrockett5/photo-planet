import type { DB } from '../db.js';
import type { LocationSource, MediaRow, Status } from './types.js';

export type NewMedia = Omit<
  MediaRow,
  'status' | 'error' | 'thumb_path' | 'display_path' | 'phash' | 'color_sig' | 'dedupe_pending'
>;

/** All SQL for the media table. */
export class MediaRepo {
  constructor(private db: DB) {}

  insert(row: NewMedia): MediaRow {
    this.db
      .prepare(
        `INSERT INTO media (id, original_name, mime, kind, size, sha256, lat, lon, location_source,
           taken_at, taken_subsec, uploaded_at, width, height, duration, original_path, dedupe_pending)
         VALUES (@id, @original_name, @mime, @kind, @size, @sha256, @lat, @lon, @location_source,
           @taken_at, @taken_subsec, @uploaded_at, @width, @height, @duration, @original_path, 1)`,
      )
      .run(row);
    return this.get(row.id)!;
  }

  /** Put back a complete row exactly as it was (undoing a merge). */
  restore(row: MediaRow): void {
    const cols = Object.keys(row);
    this.db
      .prepare(`INSERT INTO media (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`)
      .run(row);
  }

  get(id: string): MediaRow | undefined {
    return this.db.prepare('SELECT * FROM media WHERE id = ?').get(id) as MediaRow | undefined;
  }

  findBySha(sha256: string): MediaRow | undefined {
    return this.db.prepare('SELECT * FROM media WHERE sha256 = ? LIMIT 1').get(sha256) as MediaRow | undefined;
  }

  list(): MediaRow[] {
    return this.db
      .prepare('SELECT * FROM media ORDER BY taken_at IS NULL, taken_at, uploaded_at')
      .all() as MediaRow[];
  }

  /** Ready items whose thumbnail hasn't been fingerprinted yet (made before duplicate detection). */
  idsWithoutFingerprint(): string[] {
    return (
      this.db
        .prepare("SELECT id FROM media WHERE status = 'ready' AND thumb_path IS NOT NULL AND phash IS NULL")
        .all() as { id: string }[]
    ).map((r) => r.id);
  }

  /** Other fingerprinted items of the same kind: candidates for being a duplicate. */
  fingerprinted(kind: MediaRow['kind'], exceptId: string): MediaRow[] {
    return this.db
      .prepare('SELECT * FROM media WHERE kind = ? AND length(phash) > 0 AND color_sig IS NOT NULL AND id != ?')
      .all(kind, exceptId) as MediaRow[];
  }

  idsWithStatus(status: Status): string[] {
    return (this.db.prepare('SELECT id FROM media WHERE status = ?').all(status) as { id: string }[]).map((r) => r.id);
  }

  setLocation(id: string, lat: number | null, lon: number | null, source: LocationSource | null): void {
    this.db.prepare('UPDATE media SET lat = ?, lon = ?, location_source = ? WHERE id = ?').run(lat, lon, source, id);
  }

  update(id: string, fields: Partial<Omit<MediaRow, 'id'>>): void {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const set = keys.map((k) => `${k} = @${k}`).join(', ');
    this.db.prepare(`UPDATE media SET ${set} WHERE id = @id`).run({ ...fields, id });
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM media WHERE id = ?').run(id);
  }
}
