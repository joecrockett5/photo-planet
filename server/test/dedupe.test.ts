import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { matchScore, mergedFields, pickKeeper, TRASH_DAYS } from '../src/media/dedupe.js';
import { colorDistance, fingerprint, hashDistance } from '../src/media/fingerprint.js';
import type { MediaRow } from '../src/media/types.js';
import { multipart, testApp, type TestApp } from './helpers.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** A deterministic "photo": overlapping shapes on a gradient, different for each seed. */
async function scene(seed: number, width = 1200, height = 900): Promise<Buffer> {
  let s = seed * 9301 + 49297;
  const rand = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const shapes = Array.from({ length: 14 }, () => {
    const color = `rgb(${Math.floor(rand() * 255)},${Math.floor(rand() * 255)},${Math.floor(rand() * 255)})`;
    const x = rand() * width;
    const y = rand() * height;
    return rand() < 0.5
      ? `<circle cx="${x}" cy="${y}" r="${40 + rand() * 220}" fill="${color}"/>`
      : `<rect x="${x - 150}" y="${y - 100}" width="${80 + rand() * 400}" height="${60 + rand() * 300}" fill="${color}"/>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="rgb(${seed * 37 % 255},90,160)"/><stop offset="1" stop-color="rgb(240,${seed * 53 % 255},80)"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>${shapes.join('')}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

/** Splice an EXIF block (APP1) into a JPEG straight after its SOI marker. */
function withExif(jpeg: Buffer, exif: Buffer): Buffer {
  const header = Buffer.from([0xff, 0xe1, 0, 0]);
  header.writeUInt16BE(exif.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), header, exif, jpeg.subarray(2)]);
}

/** The Lisbon fixture's EXIF: GPS 38.7223, -9.1393 and a 2023-06-14 capture date. */
async function lisbonExif(): Promise<Buffer> {
  const meta = await sharp(path.join(fixtures, 'photo-lisbon.jpg')).metadata();
  return meta.exif!;
}

/** What WhatsApp does to a photo: smaller, recompressed, metadata stripped. */
async function whatsapp(jpeg: Buffer, edge = 800, quality = 60): Promise<Buffer> {
  return sharp(jpeg).resize(edge, edge, { fit: 'inside' }).jpeg({ quality }).toBuffer();
}

function row(fields: Partial<MediaRow>): MediaRow {
  return {
    id: 'x',
    original_name: 'x.jpg',
    mime: 'image/jpeg',
    kind: 'photo',
    size: 1,
    sha256: '',
    lat: null,
    lon: null,
    location_source: null,
    taken_at: null,
    taken_subsec: null,
    uploaded_at: '2026-01-01T00:00:00.000Z',
    width: 4000,
    height: 3000,
    duration: null,
    status: 'ready',
    error: null,
    original_path: 'originals/x.jpg',
    thumb_path: null,
    display_path: null,
    phash: 'ffff0000ffff0000',
    color_sig: '00'.repeat(48),
    dedupe_pending: 0,
    ...fields,
  };
}

describe('fingerprints', () => {
  it('match a recompressed, resized copy and tell different photos apart', async () => {
    const original = await scene(1);
    const [a, b, c] = await Promise.all([fingerprint(original), fingerprint(await whatsapp(original, 600, 50)), fingerprint(await scene(2))]);
    expect(hashDistance(a.phash, b.phash)).toBeLessThanOrEqual(3);
    expect(colorDistance(a.color, b.color)).toBeLessThan(5);
    expect(hashDistance(a.phash, c.phash)).toBeGreaterThan(12);
  });

  it('leave out nearly flat images, whose hash would be noise', async () => {
    const dark = await sharp({ create: { width: 640, height: 360, channels: 3, background: '#060606' } }).jpeg().toBuffer();
    expect((await fingerprint(dark)).phash).toBe('');
    expect(matchScore(row({ phash: '' }), row({ phash: '' }))).toBeNull();
  });

  it('counts differing bits', () => {
    expect(hashDistance('0000000000000000', '0000000000000000')).toBe(0);
    expect(hashDistance('ffffffffffffffff', '0000000000000000')).toBe(64);
    expect(hashDistance('8000000000000001', '0000000000000000')).toBe(2);
  });
});

describe('duplicate rules', () => {
  it('needs the same kind, shape and (for photos) capture moment', () => {
    const a = row({ id: 'a' });
    expect(matchScore(a, row({ id: 'b' }))).toBe(0);
    expect(matchScore(a, row({ id: 'b', width: 3000, height: 3000 }))).toBeNull();
    expect(matchScore(a, row({ id: 'b', width: 1600, height: 1200 }))).toBe(0);
    expect(matchScore(a, row({ id: 'b', kind: 'video', duration: 3 }))).toBeNull();
    expect(matchScore(a, row({ id: 'b', phash: 'ffff0000ffff00ff' }))).toBeNull(); // 8 bits off
    // a date on only one side is fine (WhatsApp strips them)
    expect(matchScore(row({ taken_at: '2023-06-14T18:32:05' }), row({}))).toBe(0);
    expect(matchScore(row({ taken_at: '2023-06-14T18:32:05+01:00' }), row({ taken_at: '2023-06-14T18:32:05' }))).toBe(0);
    expect(matchScore(row({ taken_at: '2023-06-14T18:32:05' }), row({ taken_at: '2023-06-14T18:32:06' }))).toBeNull();
    // burst shots in the same second
    const burst = { taken_at: '2023-06-14T18:32:05' };
    expect(matchScore(row({ ...burst, taken_subsec: '120' }), row({ ...burst, taken_subsec: '450' }))).toBeNull();
    expect(matchScore(row({ ...burst, taken_subsec: '12' }), row({ ...burst, taken_subsec: '120' }))).toBe(0);
  });

  it('needs videos to be the same length', () => {
    const v = { kind: 'video' as const, width: 1920, height: 1080 };
    expect(matchScore(row({ ...v, duration: 12.0 }), row({ ...v, duration: 12.1, taken_at: '2020-01-01T00:00:00Z' }))).toBe(0);
    expect(matchScore(row({ ...v, duration: 12.0 }), row({ ...v, duration: 14 }))).toBeNull();
    expect(matchScore(row({ ...v, duration: 12.0 }), row({ ...v, duration: null }))).toBeNull();
  });

  it('keeps the bigger file, then the one with metadata, then the newer upload', () => {
    const small = row({ id: 'small', width: 1600, height: 1200, uploaded_at: '2026-02-01T00:00:00Z' });
    const big = row({ id: 'big' });
    expect(pickKeeper(small, big).keep.id).toBe('big');
    const exif = row({ id: 'exif', lat: 1, lon: 2, location_source: 'exif' });
    expect(pickKeeper(exif, row({ id: 'bare', uploaded_at: '2026-02-01T00:00:00Z' })).keep.id).toBe('exif');
    expect(pickKeeper(row({ id: 'old' }), row({ id: 'new', uploaded_at: '2026-02-01T00:00:00Z' })).keep.id).toBe('new');
  });

  it('prefers a location from metadata, then a manual one, then the newer upload', () => {
    const old = { uploaded_at: '2026-01-01T00:00:00Z' };
    const recent = { uploaded_at: '2026-02-01T00:00:00Z' };
    const exifOld = row({ ...old, lat: 1, lon: 1, location_source: 'exif' });
    const exifNew = row({ ...recent, lat: 2, lon: 2, location_source: 'exif' });
    const manualOld = row({ ...old, lat: 3, lon: 3, location_source: 'manual' });
    const manualNew = row({ ...recent, lat: 4, lon: 4, location_source: 'manual' });
    const none = row({ ...recent });
    // metadata beats manual, whichever is kept and whichever is newer
    expect(mergedFields(manualNew, exifOld)).toMatchObject({ lat: 1, location_source: 'exif' });
    expect(mergedFields(exifOld, manualNew)).toMatchObject({ lat: 1, location_source: 'exif' });
    // both from metadata: the newer upload wins
    expect(mergedFields(exifOld, exifNew)).toMatchObject({ lat: 2 });
    expect(mergedFields(exifNew, exifOld)).toMatchObject({ lat: 2 });
    expect(mergedFields(manualOld, manualNew)).toMatchObject({ lat: 4 });
    // anything beats nothing
    expect(mergedFields(none, manualOld)).toMatchObject({ lat: 3, location_source: 'manual' });
    expect(mergedFields(manualOld, none)).toMatchObject({ lat: 3, location_source: 'manual' });
    expect(mergedFields(none, row({}))).toMatchObject({ lat: null, location_source: null });
  });

  it('fills in a missing date from the other copy', () => {
    const dated = row({ taken_at: '2023-06-14T18:32:05', taken_subsec: '12' });
    expect(mergedFields(row({}), dated)).toMatchObject({ taken_at: '2023-06-14T18:32:05', taken_subsec: '12' });
    expect(mergedFields(row({ taken_at: '2024-01-01T00:00:00' }), dated)).toMatchObject({ taken_at: '2024-01-01T00:00:00', taken_subsec: null });
  });
});

describe('duplicate uploads', () => {
  let app: TestApp;
  beforeEach(() => {
    app = testApp();
  });
  afterEach(async () => {
    await app.cleanup();
  });

  async function upload(name: string, data: Buffer) {
    const res = await app.inject({ method: 'POST', url: '/api/media', ...multipart([{ name, data }]) });
    expect(res.statusCode).toBe(201);
    await app.ctx.queue.idle();
    return res.json().results[0].item.id as string;
  }
  const list = async () => (await app.inject({ method: 'GET', url: '/api/media' })).json();
  const trash = (id: string) => app.ctx.storage.trashDirFor(id);

  it('replaces an unplaced WhatsApp copy with the original uploaded later', async () => {
    const original = withExif(await scene(1), await lisbonExif());
    const copy = await upload('IMG-20230614-WA0003.jpg', await whatsapp(original));
    // it was placed by hand somewhere else in the meantime
    await app.inject({ method: 'PATCH', url: `/api/media/${copy}`, payload: { lat: 10, lon: 10 } });

    const id = await upload('IMG_0001.JPG', original);
    const { items, merges } = await list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id, name: 'IMG_0001.JPG', locationSource: 'exif', takenAt: '2023-06-14T18:32:05+01:00', width: 1200 });
    expect(items[0].lat).toBeCloseTo(38.7223, 4);
    expect(merges).toEqual([expect.objectContaining({ uploadId: id, keptId: id, removedId: copy })]);
    expect(existsSync(path.join(trash(copy), 'originals'))).toBe(true);
    expect(existsSync(app.ctx.storage.derivedDirFor(copy))).toBe(false);

    // undo: both are back as they were
    const undo = await app.inject({ method: 'POST', url: '/api/merges/undo', payload: { ids: [merges[0].id] } });
    expect(undo.statusCode).toBe(200);
    const after = await list();
    expect(after.items).toHaveLength(2);
    expect(after.merges).toEqual([]);
    const restored = after.items.find((i: { id: string }) => i.id === copy);
    expect(restored).toMatchObject({ status: 'ready', lat: 10, lon: 10, locationSource: 'manual' });
    expect((await app.inject({ method: 'GET', url: `/media/${copy}/thumb` })).statusCode).toBe(200);
    expect(existsSync(trash(copy))).toBe(false);
    // and stay apart if the original is processed again
    app.ctx.repo.update(id, { dedupe_pending: 1 });
    await app.ctx.deduper.check(id);
    expect((await list()).items).toHaveLength(2);
  });

  it('drops a WhatsApp copy uploaded after the original', async () => {
    const original = withExif(await scene(3), await lisbonExif());
    const id = await upload('IMG_0002.JPG', original);
    const copy = await upload('IMG-WA0001.jpg', await whatsapp(original));
    const { items, merges } = await list();
    expect(items.map((i: { id: string }) => i.id)).toEqual([id]);
    expect(merges).toEqual([expect.objectContaining({ uploadId: copy, keptId: id, removedId: copy })]);

    // undone, the copy comes back finished, not stuck processing
    await app.inject({ method: 'POST', url: '/api/merges/undo', payload: { ids: [merges[0].id] } });
    expect((await list()).items.find((i: { id: string }) => i.id === copy)).toMatchObject({ status: 'ready', locationSource: null });
  });

  it('keeps a manual location when the bigger copy has none', async () => {
    const big = await scene(4); // no metadata at all, e.g. exported from an editor
    const copy = await upload('small.jpg', await whatsapp(big));
    await app.inject({ method: 'PATCH', url: `/api/media/${copy}`, payload: { lat: -33.9, lon: 18.4 } });
    const id = await upload('big.jpg', big);
    const { items } = await list();
    expect(items).toEqual([expect.objectContaining({ id, lat: -33.9, lon: 18.4, locationSource: 'manual' })]);
  });

  it('removes every older copy of the same photo', async () => {
    const original = await scene(5);
    await upload('wa1.jpg', await whatsapp(original, 800, 60));
    await upload('wa2.jpg', await whatsapp(original, 640, 45));
    // wa2 matched wa1; say they were kept apart with undo
    const first = (await list()).merges;
    expect(first).toHaveLength(1);
    await app.inject({ method: 'POST', url: '/api/merges/undo', payload: { ids: [first[0].id] } });
    expect((await list()).items).toHaveLength(2);

    // the original replaces both
    const id = await upload('original.jpg', original);
    const { items, merges } = await list();
    expect(items.map((i: { id: string }) => i.id)).toEqual([id]);
    expect(merges).toHaveLength(2);
    expect(merges.every((m: { uploadId: string; keptId: string }) => m.uploadId === id && m.keptId === id)).toBe(true);
    // undoing them all (newest first) unwinds the chain
    await app.inject({ method: 'POST', url: '/api/merges/undo', payload: { ids: merges.map((m: { id: number }) => m.id) } });
    expect((await list()).items).toHaveLength(3);
  });

  it('leaves different photos alone', async () => {
    await upload('a.jpg', await scene(6));
    await upload('b.jpg', await scene(7));
    await upload('c.jpg', await whatsapp(await scene(8)));
    expect((await list()).items).toHaveLength(3);
  });

  it('never merges items that were already in the library', async () => {
    const original = await scene(9);
    const a = await upload('a.jpg', original);
    app.ctx.repo.update(a, { phash: null, color_sig: null }); // as if from before this feature
    const copy = await upload('b.jpg', await whatsapp(original));
    // the copy was checked before `a` had a fingerprint, so both stay
    expect((await list()).items).toHaveLength(2);
    // a restart fingerprints `a`, but doesn't merge old items with each other
    app.ctx.queue.resume();
    await app.ctx.queue.idle();
    expect(app.ctx.repo.get(a)?.phash).toBeTruthy();
    expect((await list()).items.map((i: { id: string }) => i.id).sort()).toEqual([a, copy].sort());
  });

  it('deletes the hidden older copies with the item, and after 30 days', async () => {
    const one = await scene(10);
    const copy1 = await upload('wa.jpg', await whatsapp(one));
    const kept1 = await upload('one.jpg', one);
    const two = await scene(11);
    const copy2 = await upload('wa2.jpg', await whatsapp(two));
    await upload('two.jpg', two);
    expect(existsSync(trash(copy1))).toBe(true);
    expect(existsSync(trash(copy2))).toBe(true);

    await app.inject({ method: 'DELETE', url: `/api/media/${kept1}` });
    expect(existsSync(trash(copy1))).toBe(false);
    expect(existsSync(trash(copy2))).toBe(true);

    expect(await app.ctx.deduper.purgeExpired(Date.now() + (TRASH_DAYS + 1) * 86_400_000)).toBe(1);
    expect(existsSync(trash(copy2))).toBe(false);
    const undo = await app.inject({ method: 'POST', url: '/api/merges/undo', payload: { ids: [1, 2] } });
    expect(undo.statusCode).toBe(404);
  });

  it('keeps burst shots apart even when an undated copy resembles both', async () => {
    const real = app.ctx.extractMetadata;
    let subsec: string | null = '100';
    app.ctx.extractMetadata = async (file, kind) => ({
      ...(await real(file, kind)),
      ...(subsec ? { takenAt: '2024-05-01T10:00:00', takenSubsec: subsec } : {}),
    });
    const shot = await scene(12);
    const a = await upload('IMG_0100.JPG', shot);
    subsec = '300';
    const b = await upload('IMG_0101.JPG', await sharp(shot).jpeg({ quality: 88 }).toBuffer());
    subsec = null;
    await upload('IMG-WA0100.jpg', await whatsapp(shot));
    // the copy goes into one of them, but the two shots stay
    const ids = (await list()).items.map((i: { id: string }) => i.id);
    expect(ids.sort()).toEqual([a, b].sort());
  });

  // The file moves are awaited, so other requests can run in the middle of a merge.
  function duringMove(fn: (row: MediaRow) => unknown) {
    const d = app.ctx.deduper as unknown as { moveFiles: (row: MediaRow, dir: string) => Promise<void> };
    const move = d.moveFiles.bind(d);
    let once = false;
    d.moveFiles = async (row, dir) => {
      await move(row, dir);
      if (dir === 'to-trash' && !once) {
        once = true;
        await fn(row);
      }
    };
  }

  it('keeps a location set on the kept item during the merge', async () => {
    const original = await scene(13);
    await upload('wa.jpg', await whatsapp(original));
    let kept = '';
    duringMove(async () => {
      kept = (await list()).items.find((i: { name: string }) => i.name === 'orig.jpg').id;
      await app.inject({ method: 'PATCH', url: `/api/media/${kept}`, payload: { lat: 5, lon: 5 } });
    });
    await upload('orig.jpg', original);
    expect((await list()).items).toEqual([expect.objectContaining({ id: kept, lat: 5, lon: 5 })]);
  });

  it('finishes deleting a copy deleted during the merge', async () => {
    const original = await scene(14);
    const id = await upload('orig.jpg', original);
    let deleted: Promise<unknown> = Promise.resolve();
    duringMove(async (row) => {
      // (the request then waits for the merge to finish)
      deleted = app.inject({ method: 'DELETE', url: `/api/media/${row.id}` });
      await new Promise((r) => setTimeout(r, 50));
    });
    const copy = await upload('wa.jpg', await whatsapp(original));
    await deleted;
    expect((await list())).toEqual({ items: [expect.objectContaining({ id })], merges: [] });
    expect(readdirSync(app.ctx.storage.originalsDir)).toHaveLength(1);
    expect(existsSync(trash(copy))).toBe(false);
  });

  it('keeps the copy when the item it would merge into is deleted during the merge', async () => {
    const original = await scene(15);
    const id = await upload('orig.jpg', original);
    let deleted: Promise<unknown> = Promise.resolve();
    duringMove(async () => {
      deleted = app.inject({ method: 'DELETE', url: `/api/media/${id}` });
      await new Promise((r) => setTimeout(r, 50));
    });
    const copy = await upload('wa.jpg', await whatsapp(original));
    await deleted;
    expect((await list())).toEqual({ items: [expect.objectContaining({ id: copy, status: 'ready' })], merges: [] });
    expect((await app.inject({ method: 'GET', url: `/media/${copy}/original` })).statusCode).toBe(200);
    expect(existsSync(trash(copy))).toBe(false);
  });

  it('rolls back a merge, or finishes an undo, cut short by a restart', async () => {
    const original = await scene(16);
    const copy = await upload('wa.jpg', await whatsapp(original));
    const id = await upload('orig.jpg', original);
    const merge = app.ctx.db.prepare('SELECT * FROM merges').get() as { id: number; removed_row: string };
    const removed = JSON.parse(merge.removed_row) as MediaRow;

    // crashed after moving the copy's files, before the database said so
    // (and so before the new upload was marked checked and ready)
    app.ctx.repo.restore(removed);
    app.ctx.repo.update(id, { status: 'processing', dedupe_pending: 1 });
    app.ctx.db.prepare("UPDATE merges SET state = 'moving' WHERE id = ?").run(merge.id);
    await app.ctx.deduper.recover();
    expect(app.ctx.db.prepare('SELECT COUNT(*) AS n FROM merges').get()).toEqual({ n: 0 });
    expect(existsSync(app.ctx.storage.abs(removed.original_path))).toBe(true);
    expect(existsSync(trash(copy))).toBe(false);
    // and the copy is checked again when the queue resumes
    app.ctx.queue.resume();
    await app.ctx.queue.idle();
    const again = (await list()).merges;
    expect(again).toEqual([expect.objectContaining({ keptId: id, removedId: copy })]);

    // crashed half-way through an undo: the original was back, the row wasn't
    const { rename } = await import('node:fs/promises');
    await rename(path.join(trash(copy), removed.original_path), app.ctx.storage.abs(removed.original_path));
    app.ctx.db.prepare("UPDATE merges SET state = 'restoring' WHERE id = ?").run(again[0].id);
    await app.ctx.deduper.recover();
    expect((await list()).items).toHaveLength(2);
    expect((await app.inject({ method: 'GET', url: `/media/${copy}/thumb` })).statusCode).toBe(200);
    expect(existsSync(trash(copy))).toBe(false);
  });

  it('does not purge a merge that was undone first', async () => {
    const original = await scene(17);
    await upload('wa.jpg', await whatsapp(original));
    await upload('orig.jpg', original);
    const [m] = (await list()).merges;
    const undo = app.ctx.deduper.undo([m.id]);
    const purged = app.ctx.deduper.purgeExpired(Date.now() + (TRASH_DAYS + 1) * 86_400_000);
    expect((await undo).undone).toBe(1);
    expect(await purged).toBe(0);
    expect(app.ctx.db.prepare('SELECT state FROM merges').get()).toEqual({ state: 'undone' });
  });

  it.skipIf(!hasFfmpeg)('replaces a re-encoded video with the original', async () => {
    const dir = app.ctx.storage.tmpDir;
    const original = path.join(dir, 'orig.mp4');
    const copy = path.join(dir, 'copy.mp4');
    // a moving test pattern, then a smaller, harder-compressed copy without metadata
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=3', '-pix_fmt', 'yuv420p', '-metadata', 'location=+48.8584+002.2945/', original]);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', original, '-vf', 'scale=320:180', '-crf', '35', '-map_metadata', '-1', copy]);
    const copyId = await upload('VID-WA0001.mp4', readFileSync(copy));
    const id = await upload('IMG_0003.MOV.mp4', readFileSync(original));
    const { items } = await list();
    expect(items).toEqual([expect.objectContaining({ id, kind: 'video', locationSource: 'exif' })]);
    expect(items[0].lat).toBeCloseTo(48.8584, 3);
    expect(existsSync(trash(copyId))).toBe(true);
  });
});
