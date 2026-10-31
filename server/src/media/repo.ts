import type { DB } from '../db.js';
import type { LocationSource, MediaRow, Status } from './types.js';

export type NewMedia = Omit<MediaRow, 'status' | 'error' | 'thumb_path' | 'display_path'>;

/** All SQL for the media table. */
export class MediaRepo {
  constructor(private db: DB) {}

  insert(row: NewMedia): MediaRow {
    this.db
      .prepare(
        `INSERT INTO media (id, original_name, mime, kind, size, sha256, lat, lon, location_source,
           taken_at, uploaded_at, width, height, duration, original_path)
         VALUES (@id, @original_name, @mime, @kind, @size, @sha256, @lat, @lon, @location_source,
           @taken_at, @uploaded_at, @width, @height, @duration, @original_path)`,
      )
      .run(row);
    return this.get(row.id)!;
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
