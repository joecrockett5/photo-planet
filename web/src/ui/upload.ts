import { uploadFile, type MediaItem } from '../api';
import { store } from '../store';
import { h } from './dom';
import { icon } from './icons';

/**
 * The "+" button, drag-and-drop anywhere, and quiet progress: "3/12" by the
 * button and a one-pixel bar along the bottom edge.
 */
export class Uploader {
  readonly button: HTMLButtonElement;
  private input: HTMLInputElement;
  private status = h('span.upload-status', { 'aria-live': 'polite' });
  private bar = h('div.upload-bar', { hidden: true });
  private queue: File[] = [];
  private total = 0;
  private done = 0;
  private failed = 0;
  private busy = false;
  private added: MediaItem[] = [];
  private statusTimer: number | undefined;
  onBatchDone: ((added: MediaItem[]) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.input = h('input', {
      type: 'file',
      multiple: true,
      accept: 'image/*,video/*,.heic,.heif,.mov,.mp4,.webm',
      hidden: true,
    });
    this.input.addEventListener('change', () => {
      this.add([...(this.input.files ?? [])]);
      this.input.value = '';
    });
    this.button = h('button.icon-button.upload-button', { 'aria-label': 'Add photos and videos', onclick: () => this.input.click() }, icon('plus'));
    parent.append(h('div.upload', {}, this.status, this.button), this.input, this.bar);
    this.attachDrop();
  }

  add(files: File[]): void {
    if (!files.length) return;
    this.queue.push(...files);
    this.total += files.length;
    void this.pump();
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    clearTimeout(this.statusTimer);
    this.bar.hidden = false;
    let file: File | undefined;
    while ((file = this.queue.shift())) {
      this.status.textContent = `${this.done + 1}/${this.total}`;
      const result = await uploadFile(file, (f) => this.progress(this.done + f));
      this.done++;
      this.progress(this.done);
      if (result.item) {
        store.upsert(result.item);
        if (!result.duplicate) this.added.push(result.item);
      } else {
        this.failed++;
        console.warn(`upload of ${result.name} failed: ${result.error}`);
      }
    }
    this.busy = false;
    this.bar.hidden = true;
    const added = this.added;
    this.status.textContent = this.failed ? `${this.failed} failed` : `${this.total - this.failed} added`;
    if (added.length !== this.total - this.failed) this.status.textContent += ` (${this.total - this.failed - added.length} already here)`;
    this.statusTimer = window.setTimeout(() => (this.status.textContent = ''), 4000);
    this.total = this.done = this.failed = 0;
    this.added = [];
    this.onBatchDone?.(added);
  }

  private progress(units: number) {
    this.bar.style.setProperty('--progress', String(this.total ? units / this.total : 0));
  }

  private attachDrop() {
    let depth = 0;
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      depth++;
      document.body.classList.add('dropping');
    });
    addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) document.body.classList.remove('dropping');
    });
    addEventListener('dragover', (e) => {
      if (hasFiles(e)) e.preventDefault();
    });
    addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      document.body.classList.remove('dropping');
      this.add([...(e.dataTransfer?.files ?? [])]);
    });
  }
}
