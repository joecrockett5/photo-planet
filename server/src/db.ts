import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

export type DB = Database.Database;

// server/migrations, from both src/ (tsx, vitest) and dist/ (built).
const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));

/** Open (or create) the database and apply any pending numbered migrations. */
export function openDb(file: string): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function migrate(db: DB, dir = migrationsDir): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => (r as { version: number }).version),
  );
  const files = readdirSync(dir)
    .map((name) => ({ name, version: Number(/^(\d+)_.*\.sql$/.exec(name)?.[1]) }))
    .filter((f) => Number.isInteger(f.version))
    .sort((a, b) => a.version - b.version);

  const done: number[] = [];
  for (const f of files) {
    if (applied.has(f.version)) continue;
    const sql = readFileSync(path.join(dir, f.name), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        f.version,
        new Date().toISOString(),
      );
    })();
    done.push(f.version);
  }
  return done;
}
