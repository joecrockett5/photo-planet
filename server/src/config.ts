import { randomBytes } from 'node:crypto';
import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  dataDir: path.resolve(env.DATA_DIR ?? './data'),
  appPassword: env.APP_PASSWORD || undefined,
  sessionSecret: env.SESSION_SECRET || randomBytes(32).toString('hex'),
  planetTitle: env.PLANET_TITLE || 'Photo Planet',
  maxUploadMb: Number(env.MAX_UPLOAD_MB ?? 500),
  // Built frontend; served in production only (in dev, Vite serves it).
  webDist: path.resolve(env.WEB_DIST ?? new URL('../../web/dist', import.meta.url).pathname),
};
