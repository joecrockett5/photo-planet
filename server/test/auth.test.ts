import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { testApp, type TestApp } from './helpers.js';

let app: TestApp;
afterEach(async () => {
  await app?.cleanup();
});

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : String(raw);
  return first.split(';')[0]!;
}

describe('without APP_PASSWORD', () => {
  it('is open', async () => {
    app = testApp();
    expect((await app.inject({ method: 'GET', url: '/api/media' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/config' })).json()).toMatchObject({
      authRequired: false,
      authenticated: true,
    });
  });
});

describe('with APP_PASSWORD', () => {
  const login = (password: string) => app.inject({ method: 'POST', url: '/api/login', payload: { password } });

  it('protects /api and /media but not health, config or login', async () => {
    app = testApp({ appPassword: 'hunter2', sessionSecret: 's'.repeat(32) });
    expect((await app.inject({ method: 'GET', url: '/api/media' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/api/media/abc' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/media' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/media/abc/original' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/config' })).json()).toMatchObject({
      authRequired: true,
      authenticated: false,
    });
  });

  it('rejects a wrong password and accepts the right one with a long-lived httpOnly cookie', async () => {
    app = testApp({ appPassword: 'hunter2', sessionSecret: 's'.repeat(32) });
    expect((await login('nope')).statusCode).toBe(401);
    const ok = await login('hunter2');
    expect(ok.statusCode).toBe(200);
    const setCookie = String(ok.headers['set-cookie']);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Max-Age=345\d{5}/); // ~400 days
    const cookie = cookieFrom(ok);
    expect((await app.inject({ method: 'GET', url: '/api/media', headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/config', headers: { cookie } })).json().authenticated).toBe(true);
  });

  it('rejects tampered cookies, and cookies from before a password change', async () => {
    app = testApp({ appPassword: 'hunter2', sessionSecret: 's'.repeat(32) });
    const cookie = cookieFrom(await login('hunter2'));
    const tampered = cookie.replace(/v1\.(.)/, (_, c) => `v1.${c === 'A' ? 'B' : 'A'}`);
    expect((await app.inject({ method: 'GET', url: '/api/media', headers: { cookie: tampered } })).statusCode).toBe(401);
    await app.cleanup();

    app = testApp({ appPassword: 'new password', sessionSecret: 's'.repeat(32) });
    expect((await app.inject({ method: 'GET', url: '/api/media', headers: { cookie } })).statusCode).toBe(401);
  });

  it('slows down guessing', async () => {
    app = testApp({ appPassword: 'hunter2', sessionSecret: 's'.repeat(32) });
    for (let i = 0; i < 10; i++) expect((await login(`guess${i}`)).statusCode).toBe(401);
    expect((await login('guess11')).statusCode).toBe(429);
    expect((await login('hunter2')).statusCode).toBe(429);
  });
});

describe('personalisation', () => {
  it('puts PLANET_TITLE (escaped) in the served page title', async () => {
    const web = path.join(process.cwd(), 'data-test-web-' + process.pid);
    mkdirSync(web, { recursive: true });
    writeFileSync(path.join(web, 'index.html'), '<html><head><title>Photo Planet</title></head><body></body></html>');
    try {
      app = testApp({ planetTitle: 'Sam & Alex <3', webDist: web });
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<title>Sam &#38; Alex &#60;3</title>');
      expect((await app.inject({ method: 'GET', url: '/api/config' })).json().title).toBe('Sam & Alex <3');
    } finally {
      const { rmSync } = await import('node:fs');
      rmSync(web, { recursive: true, force: true });
    }
  });
});
