export type Kind = 'photo' | 'video';
export type Status = 'processing' | 'ready' | 'failed';

export interface MediaItem {
  id: string;
  kind: Kind;
  name: string;
  mime: string;
  size: number;
  lat: number | null;
  lon: number | null;
  locationSource: 'exif' | 'manual' | null;
  takenAt: string | null;
  uploadedAt: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  status: Status;
  thumbUrl: string | null;
  displayUrl: string;
  originalUrl: string;
}

export interface AppConfig {
  title: string;
  authRequired: boolean;
  authenticated: boolean;
  maxUploadMb: number;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Called when the session has expired (any 401 outside of login itself). */
export const auth = { onUnauthorized: () => {} };

async function json<T>(res: Response): Promise<T> {
  if (res.status === 401 && !res.url.endsWith('/api/login')) auth.onUnauthorized();
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new HttpError(res.status, body.error ?? res.statusText);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  config: () => fetch('/api/config').then((r) => json<AppConfig>(r)),
  list: () => fetch('/api/media').then((r) => json<{ items: MediaItem[] }>(r)).then((r) => r.items),
  setLocation: (id: string, lat: number | null, lon: number | null) =>
    fetch(`/api/media/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lat, lon }),
    })
      .then((r) => json<{ item: MediaItem }>(r))
      .then((r) => r.item),
  remove: (id: string) => fetch(`/api/media/${id}`, { method: 'DELETE' }).then((r) => json<void>(r)),
  login: (password: string) =>
    fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    }).then((r) => json<{ ok: true }>(r)),
};

export interface UploadResult {
  name: string;
  item?: MediaItem;
  duplicate?: boolean;
  error?: string;
}

/** Upload one file with progress (fetch can't report upload progress). */
export function uploadFile(file: File, onProgress: (fraction: number) => void): Promise<UploadResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status === 401) auth.onUnauthorized();
      const body = xhr.response as { results?: UploadResult[]; error?: string } | null;
      const result = body?.results?.[0];
      if (result) resolve(result);
      else resolve({ name: file.name, error: body?.error ?? `upload failed (${xhr.status})` });
    };
    xhr.onerror = () => resolve({ name: file.name, error: 'network error' });
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
}
