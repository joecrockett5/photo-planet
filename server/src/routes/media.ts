import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { ingest, UploadError } from '../media/ingest.js';
import { toItem as rowToItem, type MediaRow } from '../media/types.js';

export function mediaRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { repo, storage } = ctx;
  const toItem = (row: MediaRow) => rowToItem(row, (lat, lon) => ctx.places().lookup(lat, lon));

  app.get('/api/media', async () => ({ items: repo.list().map(toItem) }));

  app.get<{ Params: { id: string } }>('/api/media/:id', async (req, reply) => {
    const row = repo.get(req.params.id);
    if (!row) return reply.code(404).send({ error: 'not found' });
    return { item: toItem(row) };
  });

  app.post('/api/media', async (req, reply) => {
    if (!req.isMultipart()) return reply.code(400).send({ error: 'expected multipart/form-data' });
    const results: { name: string; item?: ReturnType<typeof rowToItem>; duplicate?: boolean; error?: string }[] = [];
    let worstStatus = 0;
    for await (const part of req.files()) {
      try {
        const { row, duplicate } = await ingest(
          { storage, repo, extractMetadata: ctx.extractMetadata, onIngested: ctx.onIngested },
          { filename: part.filename, mimetype: part.mimetype, stream: part.file },
        );
        results.push({ name: part.filename, item: toItem(row), duplicate });
      } catch (err) {
        if (!(err instanceof UploadError)) throw err;
        worstStatus = Math.max(worstStatus, err.statusCode);
        results.push({ name: part.filename, error: err.message });
      }
    }
    if (results.length === 0) return reply.code(400).send({ error: 'no files' });
    // A single failed file gets a proper error status; batches report per file.
    const status = results.length === 1 && results[0]!.error ? worstStatus : 201;
    return reply.code(status).send({ results });
  });

  app.patch<{ Params: { id: string }; Body: { lat?: unknown; lon?: unknown } }>(
    '/api/media/:id',
    async (req, reply) => {
      const row = repo.get(req.params.id);
      if (!row) return reply.code(404).send({ error: 'not found' });
      const { lat, lon } = req.body ?? {};
      if (lat === null && lon === null) {
        repo.setLocation(row.id, null, null, null);
      } else if (
        typeof lat === 'number' &&
        typeof lon === 'number' &&
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        Math.abs(lat) <= 90 &&
        Math.abs(lon) <= 180
      ) {
        repo.setLocation(row.id, lat, lon, 'manual');
      } else {
        return reply.code(400).send({ error: 'lat and lon must both be numbers in range, or both null' });
      }
      return { item: toItem(repo.get(row.id)!) };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/media/:id', async (req, reply) => {
    const row = repo.get(req.params.id);
    if (!row) return reply.code(404).send({ error: 'not found' });
    repo.delete(row.id);
    await storage.removeItemFiles(row.id, row.original_path);
    return reply.code(204).send();
  });

  // ---- files ----

  const cache = 'private, max-age=86400';

  app.get<{ Params: { id: string } }>('/media/:id/thumb', async (req, reply) => {
    const row = repo.get(req.params.id);
    if (!row?.thumb_path) return reply.code(404).send({ error: 'not found' });
    return reply.header('cache-control', cache).sendFile(row.thumb_path, storage.root);
  });

  app.get<{ Params: { id: string } }>('/media/:id/display', async (req, reply) => {
    const row = repo.get(req.params.id);
    if (!row) return reply.code(404).send({ error: 'not found' });
    return reply.header('cache-control', cache).sendFile(row.display_path ?? row.original_path, storage.root);
  });

  app.get<{ Params: { id: string }; Querystring: { download?: string } }>(
    '/media/:id/original',
    async (req, reply) => {
      const row = repo.get(req.params.id);
      if (!row) return reply.code(404).send({ error: 'not found' });
      if (req.query.download !== undefined) {
        const safe = row.original_name.replace(/["\\\r\n]/g, '_');
        reply.header(
          'content-disposition',
          `attachment; filename="${safe.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(row.original_name)}`,
        );
      }
      return reply.header('cache-control', cache).type(row.mime).sendFile(row.original_path, storage.root);
    },
  );
}
