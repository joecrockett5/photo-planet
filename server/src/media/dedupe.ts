import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '../db.js';
import type { Storage } from '../storage.js';
import { colorDistance, fingerprint, hashDistance } from './fingerprint.js';
import type { MediaRepo } from './repo.js';
import type { LocationSource, MediaRow } from './types.js';

/**
 * Near-duplicate detection. Byte-identical uploads are caught at ingest by
 * SHA-256; this catches the same photo or video after a messaging app has
 * resized, recompressed and stripped it, so uploading the original later
 * replaces the poor copy (or a poor copy uploaded after the original is
 * dropped). Only new uploads are checked; items already in the library are
 * never merged with each other on their own.
 *
 * The better file is kept (more pixels; then the one with metadata; then the
 * newer upload) and takes the best location and date from the pair:
 * a location from the file's metadata beats a manual one, which beats none;
 * between two of the same kind, the newer upload wins. The other copy moves
 * to trash/<id>/ for TRASH_DAYS so the merge can be undone.
 */

/** Largest fingerprint distances still counted as the same picture. */
export const MATCH = {
  photo: { hash: 6, color: 14 },
  // a video's fingerprint is a single poster frame, so be stricter (duration must match too)
  video: { hash: 4, color: 12 },
};
/** Aspect ratios may differ by this much (|ln(a/b)|): a resize rounds to whole pixels. */
const ASPECT_TOLERANCE = 0.02;
/** Pixel counts within this factor count as the same resolution. */
const SAME_SIZE = 1.05;
export const TRASH_DAYS = 30;
/** How long the uploader's page is told about a merge (it polls while processing). */
const RECENT_MS = 15 * 60_000;

/** The fields a merge can change on the kept item. */
export type MergeFields = Pick<MediaRow, 'lat' | 'lon' | 'location_source' | 'taken_at' | 'taken_subsec'>;

export interface MergeRow {
  id: number;
  upload_id: string;
  kept_id: string;
  removed_id: string;
  removed_row: string | null;
  kept_before: string;
  kept_after: string;
  created_at: string;
  state: 'active' | 'undone' | 'purged';
}

/** What the API reports about a merge. */
export interface MergeInfo {
  id: number;
  uploadId: string;
  keptId: string;
  removedId: string;
  createdAt: string;
}

// ---------------------------------------------------------------- pure rules

/** Whether `b` is the same picture as `a`, and how close (lower is closer); null if not. */
export function matchScore(a: MediaRow, b: MediaRow): number | null {
  if (a.kind !== b.kind || !a.phash || !b.phash || !a.color_sig || !b.color_sig) return null;
  if (!a.width || !a.height || !b.width || !b.height) return null;
  if (Math.abs(Math.log(a.width / a.height / (b.width / b.height))) > ASPECT_TOLERANCE) return null;

  if (a.kind === 'video') {
    if (a.duration === null || b.duration === null) return null;
    if (Math.abs(a.duration - b.duration) > Math.max(0.5, 0.02 * Math.max(a.duration, b.duration))) return null;
  } else if (!sameMoment(a, b)) {
    return null;
  }

  const limit = MATCH[a.kind];
  const hash = hashDistance(a.phash, b.phash);
  const color = colorDistance(a.color_sig, b.color_sig);
  if (hash > limit.hash || color > limit.color) return null;
  return hash + color / limit.color;
}

/**
 * Photos that both know when they were taken must agree, to the sub-second when
 * both record it: burst shots look alike but never share a timestamp. (Videos
 * aren't checked: re-encoders often rewrite their creation time.)
 */
function sameMoment(a: MediaRow, b: MediaRow): boolean {
  if (!a.taken_at || !b.taken_at) return true;
  // wall-clock part only: one copy may carry an offset the other lacks
  if (a.taken_at.slice(0, 19) !== b.taken_at.slice(0, 19)) return false;
  if (!a.taken_subsec || !b.taken_subsec) return true;
  const n = Math.min(a.taken_subsec.length, b.taken_subsec.length);
  return a.taken_subsec.slice(0, n) === b.taken_subsec.slice(0, n);
}

const pixels = (r: MediaRow) => (r.width ?? 0) * (r.height ?? 0);
const richness = (r: MediaRow) => (r.location_source === 'exif' ? 1 : 0) + (r.taken_at ? 1 : 0);
const newer = (a: MediaRow, b: MediaRow) => (a.uploaded_at >= b.uploaded_at ? a : b);

/** Which file to keep: the bigger one; at the same size the one with metadata; then the newer upload. */
export function pickKeeper(a: MediaRow, b: MediaRow): { keep: MediaRow; drop: MediaRow } {
  const pa = pixels(a);
  const pb = pixels(b);
  let keep: MediaRow;
  if (pa > pb * SAME_SIZE) keep = a;
  else if (pb > pa * SAME_SIZE) keep = b;
  else if (richness(a) !== richness(b)) keep = richness(a) > richness(b) ? a : b;
  else keep = newer(a, b);
  return { keep, drop: keep === a ? b : a };
}

const RANK: Record<LocationSource, number> = { exif: 2, manual: 1 };
const rank = (r: MediaRow) => (r.location_source && r.lat !== null && r.lon !== null ? RANK[r.location_source] : 0);

/** The kept item's fields after merging in `drop`. */
export function mergedFields(keep: MediaRow, drop: MediaRow): MergeFields {
  const rk = rank(keep);
  const rd = rank(drop);
  const from = rd > rk || (rd === rk && rd > 0 && newer(keep, drop) === drop) ? drop : keep;
  const date = keep.taken_at ? keep : drop;
  return {
    lat: from.lat,
    lon: from.lon,
    location_source: from.location_source,
    taken_at: date.taken_at,
    taken_subsec: date.taken_subsec,
  };
}

const fieldsOf = (r: MediaRow): MergeFields => ({
  lat: r.lat,
  lon: r.lon,
  location_source: r.location_source,
  taken_at: r.taken_at,
  taken_subsec: r.taken_subsec,
});

const sameFields = (a: MergeFields, b: MergeFields) =>
  (Object.keys(a) as (keyof MergeFields)[]).every((k) => a[k] === b[k]);

// ---------------------------------------------------------------- the library

type Log = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;

export class Deduper {
  /** File moves and their DB changes run one at a time. */
  private lock: Promise<unknown> = Promise.resolve();

  constructor(
    private db: DB,
    private repo: MediaRepo,
    private storage: Storage,
    private log: Log,
    private readSubsec?: (row: MediaRow) => Promise<string | null>,
  ) {}

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  /** Fingerprint an item's thumbnail (and, for older photos, read the sub-second capture time). */
  async fingerprint(id: string): Promise<void> {
    const row = this.repo.get(id);
    if (!row?.thumb_path) return;
    try {
      const fp = await fingerprint(this.storage.abs(row.thumb_path));
      const fields: Partial<MediaRow> = { phash: fp.phash, color_sig: fp.color };
      if (row.kind === 'photo' && row.taken_at && row.taken_subsec === null && this.readSubsec) {
        const subsec = await this.readSubsec(row);
        if (subsec) fields.taken_subsec = subsec;
      }
      if (this.repo.get(id)) this.repo.update(id, fields);
    } catch (err) {
      this.log.warn(`could not fingerprint ${id}: ${(err as Error).message}`);
    }
  }

  /**
   * Compare a new upload with the library and merge it with any copies of the
   * same picture. Returns the id of the item that remains.
   */
  async check(id: string): Promise<string | null> {
    return this.exclusive(async () => {
      const row = this.repo.get(id);
      if (!row) return null;
      if (!row.dedupe_pending) return id;
      this.repo.update(id, { dedupe_pending: 0 });
      if (!row.phash) return id;

      const undone = this.undonePairs();
      const matches = this.repo
        .fingerprinted(row.kind, id)
        .map((other) => ({ other, score: matchScore(row, other) }))
        .filter((m): m is { other: MediaRow; score: number } => m.score !== null)
        .sort((a, b) => a.score - b.score);

      let survivor: MediaRow = { ...row, dedupe_pending: 0 };
      for (const { other } of matches) {
        if (undone.has(pairKey(survivor.id, other.id))) continue;
        const current = this.repo.get(other.id);
        if (!current) continue;
        survivor = await this.merge(id, survivor, current);
      }
      return survivor.id;
    });
  }

  private async merge(uploadId: string, a: MediaRow, b: MediaRow): Promise<MediaRow> {
    const { keep, drop } = pickKeeper(a, b);
    const before = fieldsOf(keep);
    const after = mergedFields(keep, drop);
    // the upload being checked is finished processing; if it's undone it comes back ready
    const saved = drop.id === uploadId ? { ...drop, status: 'ready' as const, error: null } : drop;
    const restoreFiles = await this.moveFiles(drop, 'to-trash');
    try {
      this.db.transaction(() => {
        if (!this.repo.get(keep.id) || !this.repo.get(drop.id)) throw new Error('changed during merge');
        this.db
          .prepare(
            `INSERT INTO merges (upload_id, kept_id, removed_id, removed_row, kept_before, kept_after, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(uploadId, keep.id, drop.id, JSON.stringify(saved), JSON.stringify(before), JSON.stringify(after), new Date().toISOString());
        this.repo.delete(drop.id);
        this.repo.update(keep.id, after);
      })();
    } catch (err) {
      await restoreFiles();
      throw err;
    }
    this.log.info(`${drop.id} is a duplicate of ${keep.id}: kept ${keep.id} (${keep.original_name})`);
    return this.repo.get(keep.id)!;
  }

  /** Undo merges (newest first, so chains unwind in order). Returns the items that changed. */
  async undo(ids: number[]): Promise<{ items: MediaRow[]; undone: number }> {
    return this.exclusive(async () => {
      const merges = ids
        .map((id) => this.db.prepare('SELECT * FROM merges WHERE id = ?').get(id) as MergeRow | undefined)
        .filter((m): m is MergeRow => m?.state === 'active' && m.removed_row !== null)
        .sort((a, b) => b.id - a.id);
      const touched = new Set<string>();
      for (const m of merges) {
        const removed = JSON.parse(m.removed_row!) as MediaRow;
        if (this.repo.get(removed.id)) continue;
        await this.moveFiles(removed, 'from-trash');
        this.db.transaction(() => {
          this.repo.restore({ ...removed, dedupe_pending: 0 });
          const kept = this.repo.get(m.kept_id);
          // only put the kept item back if nothing has changed it since
          if (kept && sameFields(fieldsOf(kept), JSON.parse(m.kept_after) as MergeFields)) {
            this.repo.update(kept.id, JSON.parse(m.kept_before) as MergeFields);
          }
          this.db.prepare("UPDATE merges SET state = 'undone', removed_row = NULL WHERE id = ?").run(m.id);
        })();
        await rm(this.storage.trashDirFor(removed.id), { recursive: true, force: true });
        touched.add(removed.id).add(m.kept_id);
      }
      const items = [...touched].map((id) => this.repo.get(id)).filter((r): r is MediaRow => !!r);
      return { items, undone: merges.length };
    });
  }

  /** Merges the uploader's page should hear about. */
  recent(now = Date.now()): MergeInfo[] {
    const since = new Date(now - RECENT_MS).toISOString();
    return (
      this.db
        .prepare("SELECT * FROM merges WHERE state = 'active' AND created_at >= ? ORDER BY id")
        .all(since) as MergeRow[]
    ).map((m) => ({ id: m.id, uploadId: m.upload_id, keptId: m.kept_id, removedId: m.removed_id, createdAt: m.created_at }));
  }

  /** Delete trashed copies older than TRASH_DAYS. */
  async purgeExpired(now = Date.now()): Promise<number> {
    const before = new Date(now - TRASH_DAYS * 86_400_000).toISOString();
    const rows = this.db
      .prepare("SELECT * FROM merges WHERE state = 'active' AND created_at < ?")
      .all(before) as MergeRow[];
    await this.exclusive(() => this.purge(rows));
    return rows.length;
  }

  /** An item was deleted: its hidden older copies go too. */
  async forget(keptId: string): Promise<void> {
    await this.exclusive(async () => {
      const seen = new Set<string>();
      const queue = [keptId];
      const rows: MergeRow[] = [];
      let id: string | undefined;
      while ((id = queue.shift())) {
        if (seen.has(id)) continue;
        seen.add(id);
        const found = this.db
          .prepare("SELECT * FROM merges WHERE state = 'active' AND kept_id = ?")
          .all(id) as MergeRow[];
        rows.push(...found);
        // a removed copy may itself have absorbed others before it was removed
        queue.push(...found.map((m) => m.removed_id));
      }
      await this.purge(rows);
    });
  }

  private async purge(rows: MergeRow[]): Promise<void> {
    for (const m of rows) {
      await rm(this.storage.trashDirFor(m.removed_id), { recursive: true, force: true });
      this.db.prepare("UPDATE merges SET state = 'purged', removed_row = NULL WHERE id = ?").run(m.id);
    }
  }

  private undonePairs(): Set<string> {
    const rows = this.db.prepare("SELECT kept_id, removed_id FROM merges WHERE state = 'undone'").all() as {
      kept_id: string;
      removed_id: string;
    }[];
    return new Set(rows.map((r) => pairKey(r.kept_id, r.removed_id)));
  }

  /**
   * Move an item's original and derived files into trash/<id>/ (mirroring
   * their paths) or back. Returns a function that reverses the move.
   */
  private async moveFiles(row: MediaRow, direction: 'to-trash' | 'from-trash'): Promise<() => Promise<void>> {
    const trash = this.storage.trashDirFor(row.id);
    const pairs = [row.original_path, path.relative(this.storage.root, this.storage.derivedDirFor(row.id))].map(
      (rel) => ({ live: this.storage.abs(rel), hidden: path.join(trash, rel) }),
    );
    const moved: { from: string; to: string }[] = [];
    for (const p of pairs) {
      const [from, to] = direction === 'to-trash' ? [p.live, p.hidden] : [p.hidden, p.live];
      await mkdir(path.dirname(to), { recursive: true });
      try {
        await rename(from, to);
        moved.push({ from, to });
      } catch (err) {
        // no derived files yet is fine; a missing original is not
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT' || p.live.endsWith(row.original_path)) {
          for (const m of moved.reverse()) await rename(m.to, m.from).catch(() => undefined);
          throw err;
        }
      }
    }
    return async () => {
      for (const m of moved.reverse()) await rename(m.to, m.from).catch(() => undefined);
    };
  }
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
