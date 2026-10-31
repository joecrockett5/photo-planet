import { existsSync } from 'node:fs';
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
    const set = await app.inject({ method: 'PATCH', url: `/api/media/${id}`, payload: { lat: 38.72, lon: -9.14 } });
    expect(set.json().item).toMatchObject({ lat: 38.72, lon: -9.14, locationSource: 'manual' });

    const bad = await app.inject({ method: 'PATCH', url: `/api/media/${id}`, payload: { lat: 120, lon: 0 } });
    expect(bad.statusCode).toBe(400);

    const cleared = await app.inject({ method: 'PATCH', url: `/api/media/${id}`, payload: { lat: null, lon: null } });
    expect(cleared.json().item).toMatchObject({ lat: null, lon: null, locationSource: null });
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
