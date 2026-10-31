import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { heifToJpeg } from '../src/media/heif.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'photo-tokyo.heic');
const out = mkdtempSync(path.join(tmpdir(), 'pp-heif-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('heifToJpeg', () => {
  it('decodes HEIC with the bundled WebAssembly decoder (no system tools needed)', async () => {
    const file = path.join(out, 'wasm.jpg');
    expect(await heifToJpeg(fixture, file, { decoders: ['wasm'] })).toBe('wasm');
    const meta = await sharp(file).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 16, 12]);
  });

  it('falls through decoders that are missing or fail', async () => {
    const file = path.join(out, 'chain.jpg');
    // sharp's prebuilt libvips has no HEVC decoder, so this must end at wasm
    expect(await heifToJpeg(fixture, file, { decoders: ['sharp', 'wasm'] })).toBe('wasm');
  });

  it('reports every reason when nothing can decode it', async () => {
    const notHeic = path.join(path.dirname(fixture), 'photo-lisbon.jpg');
    await expect(heifToJpeg(notHeic, path.join(out, 'x.jpg'), { decoders: ['wasm'] })).rejects.toThrow(/wasm:/);
  });

  // Larger real-world files (e.g. iPhone HEICs) can be checked locally with
  // HEIC_SAMPLES=/path/to/dir npm run check -w server
  const samples = process.env.HEIC_SAMPLES;
  it.runIf(!!samples)('decodes every sample in $HEIC_SAMPLES with wasm', async () => {
    for (const name of readdirSync(samples!).filter((f) => /\.hei[cf]$/i.test(f))) {
      const file = path.join(out, `${name}.jpg`);
      const started = Date.now();
      await heifToJpeg(path.join(samples!, name), file, { decoders: ['wasm'] });
      const meta = await sharp(file).metadata();
      console.log(`${name}: ${meta.width}x${meta.height} in ${Date.now() - started}ms`);
      expect(meta.width).toBeGreaterThan(100);
    }
  }, 60_000);
});
