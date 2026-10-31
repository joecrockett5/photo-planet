import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';

export type TestApp = ReturnType<typeof buildApp> & { cleanup: () => Promise<void> };

/** A fresh app with its own temporary DATA_DIR. */
export function testApp(overrides: Partial<Config> = {}): TestApp {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'photo-planet-test-'));
  const app = buildApp({ dataDir, appPassword: undefined, webDist: path.join(dataDir, 'no-web'), ...overrides });
  return Object.assign(app, {
    cleanup: async () => {
      await app.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  });
}

/** Build a multipart body for `app.inject`. */
export function multipart(files: { name: string; data: Buffer; type?: string }[]) {
  const boundary = '----photoplanet' + Math.random().toString(16).slice(2);
  const chunks: Buffer[] = [];
  for (const f of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\n` +
          `Content-Type: ${f.type ?? 'application/octet-stream'}\r\n\r\n`,
      ),
      f.data,
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
