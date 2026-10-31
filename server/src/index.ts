import { buildApp } from './app.js';
import { config } from './config.js';

const app = buildApp();
await app.listen({ port: config.port, host: '0.0.0.0' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info(`${signal} received, shutting down`);
    app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}
