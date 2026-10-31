import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';

export const COOKIE = 'pp_session';
const MAX_AGE = 400 * 24 * 60 * 60; // seconds; browsers cap cookies at 400 days
const PUBLIC = new Set(['/api/health', '/api/config', '/api/login', '/api/logout']);
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 10;

/**
 * Single shared password. The session cookie is signed with SESSION_SECRET and
 * carries a fingerprint of the password, so changing APP_PASSWORD logs
 * everyone out.
 */
export function registerAuth(app: FastifyInstance, config: Config): void {
  const password = config.appPassword;
  const expected = password
    ? `v1.${createHmac('sha256', config.sessionSecret).update(`pw:${password}`).digest('base64url').slice(0, 22)}`
    : '';

  const isAuthed = (req: FastifyRequest): boolean => {
    if (!password) return true;
    const raw = req.cookies[COOKIE];
    if (!raw) return false;
    const { valid, value } = req.unsignCookie(raw);
    return valid && value !== null && safeEqual(value, expected);
  };
  app.decorateRequest('authed', false);

  app.addHook('onRequest', async (req, reply) => {
    req.authed = isAuthed(req);
    if (req.authed) return;
    const path = req.url.split('?')[0]!;
    const protectedPath = (path.startsWith('/api/') || path.startsWith('/media/')) && !PUBLIC.has(path);
    if (protectedPath) return reply.code(401).send({ error: 'login required' });
  });

  // Naive in-memory brute-force brake, per client IP.
  const failures = new Map<string, { count: number; since: number }>();

  app.post<{ Body: { password?: unknown } }>('/api/login', async (req, reply) => {
    if (!password) return { ok: true };
    const now = Date.now();
    const f = failures.get(req.ip);
    if (f && now - f.since < WINDOW_MS && f.count >= MAX_FAILURES) {
      return reply.code(429).send({ error: 'too many attempts, try again in a few minutes' });
    }
    const given = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!safeEqual(given, password)) {
      const entry = f && now - f.since < WINDOW_MS ? f : { count: 0, since: now };
      entry.count++;
      failures.set(req.ip, entry);
      if (failures.size > 10_000) failures.clear();
      return reply.code(401).send({ error: 'wrong password' });
    }
    failures.delete(req.ip);
    setSession(reply, req, expected);
    return { ok: true };
  });

  app.post('/api/logout', async (req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });
}

function setSession(reply: FastifyReply, req: FastifyRequest, value: string) {
  reply.setCookie(COOKIE, value, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: req.protocol === 'https',
    maxAge: MAX_AGE,
    signed: true,
  });
}

/** Constant-time comparison of two strings of any length. */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

declare module 'fastify' {
  interface FastifyRequest {
    authed: boolean;
  }
}
