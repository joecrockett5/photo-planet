import { mkdirSync } from 'node:fs';
import { buildApp } from './app.js';
import { config } from './config.js';

mkdirSync(config.dataDir, { recursive: true });

const app = buildApp();
await app.listen({ port: config.port, host: '0.0.0.0' });
