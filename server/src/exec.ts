import { execFile } from 'node:child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/** Run a binary (no shell). Rejects with stderr in the message on failure. */
export function run(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; maxBuffer?: number; signal?: AbortSignal } = {},
) {
  return new Promise<ExecResult>((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        timeout: opts.timeoutMs ?? 0,
        maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
        encoding: 'utf8',
        signal: opts.signal,
      },
      (err, stdout, stderr) => {
        if (err) {
          const tail = stderr.trim().split('\n').slice(-3).join(' | ');
          reject(Object.assign(new Error(`${cmd} failed: ${tail || err.message}`), { code: (err as { code?: unknown }).code }));
        } else {
          resolve({ stdout, stderr });
        }
      },
    );
  });
}

const available = new Map<string, Promise<boolean>>();

/** Whether a command-line tool exists. Cached; logs once when missing. */
export function hasTool(cmd: string, versionArg = '-version'): Promise<boolean> {
  let p = available.get(cmd);
  if (!p) {
    p = run(cmd, [versionArg], { timeoutMs: 10_000 }).then(
      () => true,
      (err: { code?: unknown }) => {
        // A non-zero exit still means the binary exists; ENOENT means it doesn't.
        if (err.code === 'ENOENT') {
          console.warn(`[photo-planet] '${cmd}' not found: related media features will be skipped`);
          return false;
        }
        return true;
      },
    );
    available.set(cmd, p);
  }
  return p;
}
