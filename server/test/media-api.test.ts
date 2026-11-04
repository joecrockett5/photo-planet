import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { multipart, testApp, type TestApp } from './helpers.js';

async function tinyPng(color = { r: 200, g: 40, b: 40 }): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 6, channels: 3, background: color } }).png().toBuffer();
}

describe('media api', () => {
  let app: TestApp;
  beforeEach(() => {
    app = testApp();
  });
  afterEach(async () => {
    await app.cleanup();
  });

  async function upload(files: { name: string; data: Buffer; type?: string }[]) {
    const body = multipart(files);
    return app.inject({ method: 'POST', url: '/api/media', ...body });
  }

  it('stores an upload untouched and lists it', async () => {
    const png = await tinyPng();
    const res = await upload([{ name: 'red.png', data: png, type: 'image/png' }]);
    expect(res.statusCode).toBe(201);
    const [result] = res.json().results;
    expect(result.item).toMatchObject({ kind: 'photo', name: 'red.png', mime: 'image/png', size: png.length });

    const row = app.ctx.repo.get(result.item.id)!;
    expect(existsSync(app.ctx.storage.abs(row.original_path))).toBe(true);

    const list = await app.inject({ method: 'GET', url: '/api/media' });
    expect(list.json().items.map((i: { id: string }) => i.id)).toEqual([result.item.id]);

    const original = await app.inject({ method: 'GET', url: `/media/${result.item.id}/original` });
    expect(original.statusCode).toBe(200);
    expect(original.rawPayload.equals(png)).toBe(true);
  });

  it('reads the location and date of an upload', async () => {
    const data = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'photo-lisbon.jpg'));
    const res = await upload([{ name: 'IMG_0001.JPG', data, type: 'image/jpeg' }]);
    expect(res.json().results[0].item).toMatchObject({
      kind: 'photo',
      locationSource: 'exif',
      takenAt: '2023-06-14T18:32:05+01:00',
    });
    expect(res.json().results[0].item.lat).toBeCloseTo(38.7223, 4);
    expect(res.json().results[0].item.place).toEqual({ city: 'Lisbon', country: 'Portugal' });
  });

  it('accepts several files at once and dedupes identical content', async () => {
    const a = await tinyPng();
    const b = await tinyPng({ r: 0, g: 0, b: 255 });
    const res = await upload([
      { name: 'a.png', data: a },
      { name: 'b.png', data: b },
      { name: 'a-again.png', data: a },
    ]);
    expect(res.statusCode).toBe(201);
    const results = res.json().results;
    expect(results).toHaveLength(3);
    expect(results[2].duplicate).toBe(true);
    expect(results[2].item.id).toBe(results[0].item.id);
    expect(app.ctx.repo.list()).toHaveLength(2);
  });

  it('rejects unsupported types', async () => {
    const res = await upload([{ name: 'notes.txt', data: Buffer.from('hello'), type: 'text/plain' }]);
    expect(res.statusCode).toBe(415);
    expect(app.ctx.repo.list()).toHaveLength(0);
  });

  it('rejects files over the size limit', async () => {
    await app.cleanup();
    app = testApp({ maxUploadMb: 0.001 });
    const res = await upload([{ name: 'big.jpg', data: Buffer.alloc(5000, 1) }]);
    expect(res.statusCode).toBe(413);
    expect(app.ctx.repo.list()).toHaveLength(0);
  });

  it('sets, validates and clears a location', async () => {
    const id = (await upload([{ name: 'a.png', data: await tinyPng() }])).json().results[0].item.id;
    const set = await app.inject({ method: 'PATCH', url: `/api/media/${id}`, payload: { lat: 34.6873, lon: 135.5262 } });
    expect(set.json().item).toMatchObject({
      lat: 34.6873,
      lon: 135.5262,
      locationSource: 'manual',
      place: { city: 'Osaka', country: 'Japan' },
    });

    const bad = await app.inject({ method: 'PATCH', url: `/api/media/${id}`, payload: { lat: 120, lon: 0 } });
    expect(bad.statusCode).toBe(400);

    const cleared = await app.inject({ method: 'PATCH', url: `/api/media/${id}`, payload: { lat: null, lon: null } });
    expect(cleared.json().item).toMatchObject({ lat: null, lon: null, locationSource: null, place: null });
  });

  it('places several items at once, and can clear them all', async () => {
    const res = await upload([
      { name: 'a.png', data: await tinyPng() },
      { name: 'b.png', data: await tinyPng({ r: 0, g: 200, b: 0 }) },
    ]);
    const ids = res.json().results.map((r: { item: { id: string } }) => r.item.id);
    const placed = await app.inject({ method: 'PATCH', url: '/api/media', payload: { ids, lat: 34.6937, lon: 135.5022 } });
    expect(placed.statusCode).toBe(200);
    expect(placed.json().items).toHaveLength(2);
    for (const item of placed.json().items) {
      expect(item).toMatchObject({ locationSource: 'manual', place: { city: 'Osaka', country: 'Japan' } });
    }
    const cleared = await app.inject({ method: 'PATCH', url: '/api/media', payload: { ids, lat: null, lon: null } });
    expect(cleared.json().items.every((i: { lat: unknown }) => i.lat === null)).toBe(true);

    const missing = await app.inject({ method: 'PATCH', url: '/api/media', payload: { ids: [...ids, 'nope'], lat: 1, lon: 1 } });
    expect(missing.statusCode).toBe(404);
    expect(app.ctx.repo.get(ids[0])!.lat).toBeNull(); // all or nothing
    const bad = await app.inject({ method: 'PATCH', url: '/api/media', payload: { ids: [], lat: 1, lon: 1 } });
    expect(bad.statusCode).toBe(400);
  });

  it('deletes several items at once, all or nothing', async () => {
    const res = await upload([
      { name: 'a.png', data: await tinyPng() },
      { name: 'b.png', data: await tinyPng({ r: 0, g: 200, b: 0 }) },
      { name: 'c.png', data: await tinyPng({ r: 0, g: 0, b: 200 }) },
    ]);
    const ids: string[] = res.json().results.map((r: { item: { id: string } }) => r.item.id);
    const files = ids.map((id) => app.ctx.storage.abs(app.ctx.repo.get(id)!.original_path));

    const missing = await app.inject({ method: 'DELETE', url: '/api/media', payload: { ids: [ids[0], 'nope'] } });
    expect(missing.statusCode).toBe(404);
    expect(app.ctx.repo.get(ids[0]!)).toBeTruthy(); // nothing deleted

    const del = await app.inject({ method: 'DELETE', url: '/api/media', payload: { ids: ids.slice(0, 2) } });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ deleted: 2 });
    expect(app.ctx.repo.list().map((r) => r.id)).toEqual([ids[2]]);
    expect(files.map((f) => existsSync(f))).toEqual([false, false, true]);

    expect((await app.inject({ method: 'DELETE', url: '/api/media', payload: { ids: [] } })).statusCode).toBe(400);
  });

  it('searches places by name', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/places?q=osak' });
    expect(res.json().places[0]).toMatchObject({ name: 'Osaka', country: 'Japan' });
    expect((await app.inject({ method: 'GET', url: '/api/places?q=' })).statusCode).toBe(400);
  });

  it('deletes an item and its files', async () => {
    const id = (await upload([{ name: 'a.png', data: await tinyPng() }])).json().results[0].item.id;
    const row = app.ctx.repo.get(id)!;
    const del = await app.inject({ method: 'DELETE', url: `/api/media/${id}` });
    expect(del.statusCode).toBe(204);
    expect(existsSync(app.ctx.storage.abs(row.original_path))).toBe(false);
    expect((await app.inject({ method: 'GET', url: `/api/media/${id}` })).statusCode).toBe(404);
  });

  it('serves byte ranges', async () => {
    const png = await tinyPng();
    const id = (await upload([{ name: 'a.png', data: png }])).json().results[0].item.id;
    const res = await app.inject({ method: 'GET', url: `/media/${id}/display`, headers: { range: 'bytes=0-9' } });
    expect(res.statusCode).toBe(206);
    expect(res.rawPayload.equals(png.subarray(0, 10))).toBe(true);
  });
});
