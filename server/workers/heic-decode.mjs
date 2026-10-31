// Decodes one HEIC/HEIF file with libheif compiled to WebAssembly (heic-decode
// → libheif-js), off the main thread: WASM decoding is synchronous and would
// otherwise stall the HTTP server for a second or two on a big photo.
// Plain JS (not TS) so it runs unchanged under tsx, vitest and the built app.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';

const require = createRequire(import.meta.url);
const decode = require('heic-decode');

try {
  const buffer = await readFile(workerData.file);
  const { width, height, data } = await decode({ buffer });
  const pixels = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  parentPort.postMessage({ width, height, pixels }, [pixels.buffer]);
} catch (err) {
  parentPort.postMessage({ error: err instanceof Error ? err.message : String(err) });
}
