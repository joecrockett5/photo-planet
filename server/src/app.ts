import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { config as envConfig, type Config } from './config.js';
import { registerAuth } from './auth.js';
import type { AppContext } from './context.js';
import { openDb } from './db.js';
import { Places } from './geo/places.js';
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
    places: (() => {
      let loaded: Places | null = null;
      return () => (loaded ??= Places.load());
    })(),
    onIngested: (row) => queue.enqueue(row.id),
  };
  app.addHook('onReady', async () => {
    queue.resume();
    // warm the place-name index so the first page load isn't the one waiting
    if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) setImmediate(() => ctx.places());
  });
  app.addHook('onClose', async () => {
    await queue.stop();
    db.close();
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
  });

  app.register(fastifyCookie, { secret: config.sessionSecret });
  registerAuth(app, config);

  app.register(fastifyMultipart, {
    limits: { fileSize: Math.round(config.maxUploadMb * 1024 * 1024), files: 100, fields: 10 },
  });

  // Media files (with range support, for video seeking). `serve: false`: only via reply.sendFile.
  app.register(fastifyStatic, { root: storage.root, serve: false });

  app.get('/api/health', async () => ({ ok: true, version: config.version }));

  app.get('/api/config', async (req) => ({
    title: config.planetTitle,
    authRequired: Boolean(config.appPassword),
    authenticated: req.authed,
    maxUploadMb: config.maxUploadMb,
  }));

  app.register(async (scope) => mediaRoutes(scope, ctx));

  const indexFile = path.join(config.webDist, 'index.html');
  if (existsSync(indexFile)) {
    // The page title is personalised server-side so tabs and link previews show it too.
    const index = readFileSync(indexFile, 'utf8').replace(
      /<title>[^<]*<\/title>/,
      `<title>${escapeHtml(config.planetTitle)}</title>`,
    );
    const sendIndex = async (_req: unknown, reply: import('fastify').FastifyReply) =>
      reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache').send(index);
    app.get('/', sendIndex);
    app.get('/index.html', sendIndex);
    app.register(fastifyStatic, {
      root: config.webDist,
      decorateReply: false,
      index: false,
      allowedPath: (p) => p !== '/index.html',
      // hashed asset names: cache forever
      setHeaders: (res, file) => {
        if (file.includes(`${path.sep}assets${path.sep}`)) res.header('cache-control', 'public, max-age=31536000, immutable');
      },
    });
  }

  if (config.appPassword && config.sessionSecretIsRandom) {
    app.log.warn('APP_PASSWORD is set but SESSION_SECRET is not: everyone will be logged out on every restart');
  }

  return Object.assign(app, { ctx });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
