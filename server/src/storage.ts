import { mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';

/** Layout of DATA_DIR. Everything the app writes at runtime lives under here. */
export class Storage {
  readonly dbFile: string;
  readonly originalsDir: string;
  readonly derivedDir: string;
  readonly tmpDir: string;

  constructor(readonly root: string) {
    this.dbFile = path.join(root, 'photo-planet.db');
    this.originalsDir = path.join(root, 'originals');
    this.derivedDir = path.join(root, 'derived');
    this.tmpDir = path.join(root, 'tmp');
  }

  init(): void {
    for (const dir of [this.root, this.originalsDir, this.derivedDir, this.tmpDir]) mkdirSync(dir, { recursive: true });
  }

  /** Absolute path for a path stored relative to DATA_DIR. */
  abs(rel: string): string {
    return path.join(this.root, rel);
  }

  originalRel(id: string, ext: string): string {
    return `originals/${id}.${ext}`;
  }

  derivedRel(id: string, file: string): string {
    return `derived/${id}/${file}`;
  }

  derivedDirFor(id: string): string {
    return path.join(this.derivedDir, id);
  }

  async removeItemFiles(id: string, originalRel: string): Promise<void> {
    await rm(this.abs(originalRel), { force: true });
    await rm(this.derivedDirFor(id), { recursive: true, force: true });
  }
}
