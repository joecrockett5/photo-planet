import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { config as envConfig, type Config } from './config.js';
import type { AppContext } from './context.js';
import { openDb } from './db.js';
import { extractMetadata } from './media/metadata.js';
import { JobQueue } from './media/queue.js';
import { MediaRepo } from './media/repo.js';
import { mediaRoutes } from './routes/media.js';
import { Storage } from './storage.js';

export function buildApp(overrides: Partial<Config> = {}) {
  const config: Config = { ...envConfig, ...overrides };
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test' && !process.env.VITEST,
    trustProxy: true,
  });

  const storage = new Storage(config.dataDir);
  storage.init();
  const db = openDb(storage.dbFile);
  const repo = new MediaRepo(db);
  const queue = new JobQueue(repo, storage, app.log);
  const ctx: AppContext = {
    config,
    db,
    storage,
    repo,
    extractMetadata,
    queue,
    onIngested: (row) => queue.enqueue(row.id),
  };
  app.addHook('onReady', async () => queue.resume());
  app.addHook('onClose', async () => {
    await queue.stop();
    db.close();
  });

  app.register(fastifyMultipart, {
    limits: { fileSize: Math.round(config.maxUploadMb * 1024 * 1024), files: 100, fields: 10 },
  });

  // Media files (with range support, for video seeking). `serve: false`: only via reply.sendFile.
  app.register(fastifyStatic, { root: storage.root, serve: false });

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/config', async () => ({
    title: config.planetTitle,
    authRequired: Boolean(config.appPassword),
    maxUploadMb: config.maxUploadMb,
  }));

  app.register(async (scope) => mediaRoutes(scope, ctx));

  if (existsSync(config.webDist)) {
    app.register(fastifyStatic, { root: config.webDist, decorateReply: false, wildcard: false });
  }

  return Object.assign(app, { ctx });
}
