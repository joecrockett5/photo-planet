import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planVideo } from '../src/media/derive.js';
import { multipart, testApp, type TestApp } from './helpers.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

function has(cmd: string, arg = '-version') {
  try {
    execFileSync(cmd, [arg], { stdio: 'ignore' });
    return true;
  } catch (err) {
    return (err as { code?: string }).code !== 'ENOENT';
  }
}
const hasFfmpeg = has('ffmpeg');
/** heif-convert can be installed without an HEVC decoder plugin, so try it for real. */
function canDecodeHeic() {
  if (!has('heif-convert', '--version')) return false;
  const out = path.join(tmpdir(), `pp-heic-probe-${process.pid}.jpg`);
  try {
    execFileSync('heif-convert', [path.join(fixtures, 'photo-tokyo.heic'), out], { stdio: 'ignore' });
    return existsSync(out);
  } catch {
    return false;
  } finally {
    rmSync(out, { force: true });
  }
}
const hasHeif = canDecodeHeic();
if (!hasHeif) console.warn('heif-convert cannot decode HEIC here: skipping the HEIC conversion test');

function probeCodec(file: string): string {
  return execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file], {
    encoding: 'utf8',
  }).trim();
}

describe('derived files', () => {
  let app: TestApp;
  beforeEach(() => {
    app = testApp();
  });
  afterEach(async () => {
    await app.cleanup();
  });

  async function uploadFixture(name: string) {
    const body = multipart([{ name, data: readFileSync(path.join(fixtures, name)) }]);
    const res = await app.inject({ method: 'POST', url: '/api/media', ...body });
    expect(res.statusCode).toBe(201);
    const id: string = res.json().results[0].item.id;
    await app.ctx.queue.idle();
    return app.ctx.repo.get(id)!;
  }

  it('makes a webp thumbnail for a photo and serves the original as display', async () => {
    const row = await uploadFixture('photo-lisbon.jpg');
    expect(row.status).toBe('ready');
    expect(row.display_path).toBeNull();
    const meta = await sharp(app.ctx.storage.abs(row.thumb_path!)).metadata();
    expect(meta.format).toBe('webp');
    expect(row).toMatchObject({ width: 16, height: 12 });

    const thumb = await app.inject({ method: 'GET', url: `/media/${row.id}/thumb` });
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/webp');
  });

  it('shrinks big photos to a 400px thumbnail and respects EXIF orientation', async () => {
    const big = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#336699' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const res = await app.inject({ method: 'POST', url: '/api/media', ...multipart([{ name: 'big.jpg', data: big }]) });
    await app.ctx.queue.idle();
    const row = app.ctx.repo.get(res.json().results[0].item.id)!;
    expect(row).toMatchObject({ width: 800, height: 1200 }); // rotated to portrait
    const meta = await sharp(app.ctx.storage.abs(row.thumb_path!)).metadata();
    expect([meta.width, meta.height]).toEqual([267, 400]);
  });

  it.skipIf(!hasHeif)('converts HEIC to a JPEG display version', async () => {
    const row = await uploadFixture('photo-tokyo.heic');
    expect(row.status).toBe('ready');
    expect(row.display_path).toMatch(/display\.jpg$/);
    expect((await sharp(app.ctx.storage.abs(row.display_path!)).metadata()).format).toBe('jpeg');
    expect(existsSync(app.ctx.storage.abs(row.thumb_path!))).toBe(true);
    const display = await app.inject({ method: 'GET', url: `/media/${row.id}/display` });
    expect(display.headers['content-type']).toBe('image/jpeg');
  });

  it.skipIf(!hasFfmpeg)('remuxes an H.264 MOV into MP4 and makes a poster thumbnail', async () => {
    const row = await uploadFixture('video-new-york.mov');
    expect(row.status).toBe('ready');
    expect(row.display_path).toMatch(/display\.mp4$/);
    expect(probeCodec(app.ctx.storage.abs(row.display_path!))).toBe('h264');
    expect((await sharp(app.ctx.storage.abs(row.thumb_path!)).metadata()).format).toBe('webp');
  });

  it.skipIf(!hasFfmpeg)('transcodes HEVC to H.264', async () => {
    const row = await uploadFixture('video-cape-town-hevc.mp4');
    expect(row.status).toBe('ready');
    expect(probeCodec(app.ctx.storage.abs(row.display_path!))).toBe('h264');
  });

  it.skipIf(!hasFfmpeg)('leaves browser-friendly video alone', async () => {
    for (const name of ['video-paris.mp4', 'video-no-gps.webm']) {
      const row = await uploadFixture(name);
      expect(row.status).toBe('ready');
      expect(row.display_path).toBeNull();
      expect(row.thumb_path).not.toBeNull();
    }
  });

  it('marks unreadable files as failed without crashing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/media',
      ...multipart([{ name: 'broken.jpg', data: Buffer.from('definitely not a jpeg') }]),
    });
    await app.ctx.queue.idle();
    const row = app.ctx.repo.get(res.json().results[0].item.id)!;
    expect(row.status).toBe('failed');
    expect(row.error).toBeTruthy();
  });

  it('resumes items left processing by a restart', async () => {
    const row = await uploadFixture('photo-lisbon.jpg');
    app.ctx.repo.update(row.id, { status: 'processing', thumb_path: null });
    app.ctx.queue.resume();
    await app.ctx.queue.idle();
    expect(app.ctx.repo.get(row.id)).toMatchObject({ status: 'ready', thumb_path: expect.any(String) });
  });
});

describe('planVideo', () => {
  const probe = (v: string, a?: string) => ({
    streams: [{ codec_type: 'video', codec_name: v }, ...(a ? [{ codec_type: 'audio', codec_name: a }] : [])],
  });
  it.each([
    ['video/mp4', 'h264', 'aac', 'original'],
    ['video/mp4', 'hevc', 'aac', 'transcode'],
    ['video/quicktime', 'h264', 'aac', 'remux'],
    ['video/quicktime', 'hevc', 'aac', 'transcode'],
    ['video/quicktime', 'h264', 'pcm_s16le', 'transcode'],
    ['video/webm', 'vp9', 'opus', 'original'],
    ['video/mp4', 'h264', undefined, 'original'],
  ])('%s %s/%s → %s', (mime, v, a, plan) => {
    expect(planVideo(mime, probe(v, a))).toBe(plan);
  });
});
