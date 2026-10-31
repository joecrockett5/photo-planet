import type { Config } from './config.js';
import type { DB } from './db.js';
import type { Metadata } from './media/metadata.js';
import type { JobQueue } from './media/queue.js';
import type { MediaRepo } from './media/repo.js';
import type { Kind, MediaRow } from './media/types.js';
import type { Storage } from './storage.js';

/** Shared state handed to route modules. */
export interface AppContext {
  config: Config;
  db: DB;
  storage: Storage;
  repo: MediaRepo;
  queue: JobQueue;
  extractMetadata: (file: string, kind: Kind) => Promise<Metadata>;
  onIngested: (row: MediaRow) => void;
}
