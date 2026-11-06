import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const env = process.env;

function numberFrom(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface Config {
  port: number;
  dataDir: string;
  appPassword: string | undefined;
  sessionSecret: string;
  sessionSecretIsRandom: boolean;
  planetTitle: string;
  maxUploadMb: number;
  webDist: string;
  /** Set at image build time (the release tag), "dev" otherwise. */
  version: string;
}

/** The only place env vars are read. */
export const config: Config = {
  port: numberFrom(env.PORT, 3000),
  dataDir: path.resolve(env.DATA_DIR ?? './data'),
  appPassword: env.APP_PASSWORD || undefined,
  sessionSecret: env.SESSION_SECRET || randomBytes(32).toString('hex'),
  sessionSecretIsRandom: !env.SESSION_SECRET,
  planetTitle: env.PLANET_TITLE?.trim() || 'Photo Planet',
  maxUploadMb: numberFrom(env.MAX_UPLOAD_MB, 500),
  // Built frontend; served in production only (in dev, Vite serves it).
  webDist: path.resolve(env.WEB_DIST ?? fileURLToPath(new URL('../../web/dist', import.meta.url))),
  version: env.APP_VERSION || 'dev',
};
