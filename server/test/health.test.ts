import { afterAll, describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

describe('api', () => {
  const app = testApp();
  afterAll(() => app.cleanup());

  it('reports health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, version: expect.any(String) });
  });

  it('reports config', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.json()).toMatchObject({ title: expect.any(String), authRequired: false });
  });
});
