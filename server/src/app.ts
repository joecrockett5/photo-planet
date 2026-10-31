import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';

export function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/config', async () => ({
    title: config.planetTitle,
    authRequired: Boolean(config.appPassword),
  }));

  if (existsSync(config.webDist)) {
    app.register(fastifyStatic, { root: config.webDist });
  }

  return app;
}
