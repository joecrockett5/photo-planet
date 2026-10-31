import { rm } from 'node:fs/promises';
import type { FastifyBaseLogger } from 'fastify';
import type { Storage } from '../storage.js';
import { deriveFiles, MissingToolError } from './derive.js';
import type { MediaRepo } from './repo.js';

/**
 * Makes derived files one item at a time, in the background. The heavy work
 * runs in child processes (ffmpeg, heif-convert) or sharp's thread pool, so the
 * HTTP server stays responsive. Items left `processing` by a restart are
 * picked up again by `resume()`.
 */
export class JobQueue {
  private pending: string[] = [];
  private running: Promise<void> | null = null;
  private waiters: (() => void)[] = [];
  private stopped = false;
  private abort = new AbortController();

  constructor(
    private repo: MediaRepo,
    private storage: Storage,
    private log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>,
  ) {}

  enqueue(id: string): void {
    if (this.stopped) return;
    if (!this.pending.includes(id)) this.pending.push(id);
    this.running ??= this.drain().finally(() => {
      this.running = null;
      for (const w of this.waiters.splice(0)) w();
    });
  }

  /**
   * On start-up: pick up items a restart interrupted, and give failed items
   * another go: a newer version or newly installed tool may handle them now.
   */
  resume(): void {
    for (const id of this.repo.idsWithStatus('failed')) {
      this.repo.update(id, { status: 'processing' });
    }
    for (const id of this.repo.idsWithStatus('processing')) this.enqueue(id);
  }

  /** Resolves when the queue is empty (for tests and shutdown). */
  idle(): Promise<void> {
    return this.running ? new Promise((resolve) => this.waiters.push(resolve)) : Promise.resolve();
  }

  /** Abandon queued and in-flight work (it stays `processing` and resumes next start). */
  async stop(): Promise<void> {
    this.stopped = true;
    this.pending = [];
    this.abort.abort();
    await this.idle();
  }

  get size(): number {
    return this.pending.length + (this.running ? 1 : 0);
  }

  private async drain(): Promise<void> {
    let id: string | undefined;
    while ((id = this.pending.shift())) await this.process(id);
  }

  private async process(id: string): Promise<void> {
    const row = this.repo.get(id);
    if (!row) return;
    const started = Date.now();
    const save = (fields: object) => {
      if (!this.stopped && this.repo.get(id)) this.repo.update(id, fields);
    };
    try {
      await deriveFiles(row, this.storage, save, this.abort.signal);
      save({ status: 'ready', error: null });
      this.log.info(`processed ${id} (${row.kind}) in ${Date.now() - started}ms`);
    } catch (err) {
      if (this.stopped) return;
      const message = (err as Error).message;
      if (err instanceof MissingToolError) this.log.warn(`${id}: ${message}`);
      else this.log.error(`processing ${id} failed: ${message}`);
      save({ status: 'failed', error: message.slice(0, 500) });
    }
    if (this.stopped) return;
    // Deleted while we were working on it: don't leave files behind.
    if (!this.repo.get(id)) await rm(this.storage.derivedDirFor(id), { recursive: true, force: true });
  }
}
