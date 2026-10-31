import { readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import sharp from 'sharp';
import { hasTool, run } from '../exec.js';

// server/workers, from both src/media (tsx, vitest) and dist/media (built).
const workerFile = fileURLToPath(new URL('../../workers/heic-decode.mjs', import.meta.url));

export type HeifDecoder = 'heif-dec' | 'heif-convert' | 'sharp' | 'wasm';
export const ALL_DECODERS: HeifDecoder[] = ['heif-dec', 'heif-convert', 'sharp', 'wasm'];

/**
 * Turn a HEIC/HEIF photo into a JPEG, trying in turn:
 *   1. heif-dec / heif-convert (native libheif CLI; libheif ≥1.18 renamed
 *      heif-convert to heif-dec). Fast, but missing on many machines, and on
 *      Ubuntu 24.04+/Debian trixie it needs the separate libde265 plugin.
 *   2. sharp, in case its libvips happens to have an HEVC decoder.
 *   3. libheif compiled to WebAssembly, in a worker thread. Always available.
 * Returns which one worked; throws with every failure reason if none did.
 */
export async function heifToJpeg(
  input: string,
  output: string,
  opts: { signal?: AbortSignal; decoders?: HeifDecoder[] } = {},
): Promise<HeifDecoder> {
  const failures: string[] = [];
  for (const decoder of opts.decoders ?? ALL_DECODERS) {
    if (opts.signal?.aborted) throw new Error('aborted');
    try {
      if (decoder === 'heif-dec' || decoder === 'heif-convert') {
        if (!(await hasTool(decoder, '--version', true))) {
          failures.push(`${decoder}: not installed`);
          continue;
        }
        await run(decoder, ['-q', '90', input, output], { timeoutMs: 120_000, signal: opts.signal });
        await pickPrimaryOutput(output);
      } else if (decoder === 'sharp') {
        await sharp(input).rotate().jpeg({ quality: 90 }).toFile(output);
      } else {
        const { width, height, pixels } = await decodeInWorker(input, opts.signal);
        await sharp(pixels, { raw: { width, height, channels: 4 } }).removeAlpha().jpeg({ quality: 90 }).toFile(output);
      }
      return decoder;
    } catch (err) {
      failures.push(`${decoder}: ${(err as Error).message.split('\n')[0]}`);
      await rm(output, { force: true });
    }
  }
  throw new Error(`could not decode this HEIC (${failures.join('; ')})`);
}

/** Files with several top-level images come out as name-1.jpg, name-2.jpg… keep the first. */
async function pickPrimaryOutput(output: string) {
  if (await exists(output)) return;
  const dir = path.dirname(output);
  const base = path.basename(output, '.jpg');
  const numbered = (await readdir(dir)).filter((f) => f.startsWith(`${base}-`) && f.endsWith('.jpg')).sort();
  if (numbered.length === 0) throw new Error('produced no image');
  await rename(path.join(dir, numbered[0]!), output);
  for (const extra of numbered.slice(1)) await rm(path.join(dir, extra), { force: true });
}

function decodeInWorker(file: string, signal?: AbortSignal) {
  return new Promise<{ width: number; height: number; pixels: Uint8Array }>((resolve, reject) => {
    const worker = new Worker(workerFile, { workerData: { file } });
    const onAbort = () => void worker.terminate();
    signal?.addEventListener('abort', onAbort, { once: true });
    const done = () => signal?.removeEventListener('abort', onAbort);
    worker.once('message', (msg: { error?: string; width: number; height: number; pixels: Uint8Array }) => {
      done();
      void worker.terminate();
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg);
    });
    worker.once('error', (err) => {
      done();
      reject(err);
    });
    worker.once('exit', (code) => {
      done();
      reject(new Error(`decoder stopped (${code})`));
    });
  });
}

async function exists(file: string) {
  return stat(file).then(
    () => true,
    () => false,
  );
}
