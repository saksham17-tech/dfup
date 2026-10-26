import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import type { UploadState } from './upload';

export type UploadActivity = { indices: number[]; uploading: number; waiting: boolean };
export type PieceTiming = { index: number; elapsedMs: number; confirmed: boolean };
export const EMPTY_ACTIVITY: UploadActivity = { indices: [], uploading: 0, waiting: false };

/** Observe transport activity only. The uploader's saved indices still own scoring. */
export function observeUploadActivity(
  onChange: (activity: UploadActivity) => void,
  options: { limit: number; maxAttempts?: number; client?: AxiosInstance; now?: () => number; onTiming?: (timing: PieceTiming) => void },
) {
  const client = options.client ?? axios, now = options.now ?? (() => performance.now());
  const requests = new WeakMap<object, { index: number; started: number; epoch: number }>();
  const pieces = new Map<number, { since: number; acknowledged: boolean; attempts: number }>();
  let fileId: string | null = null, status: UploadState['status'] = 'idle', epoch = 0;
  let saved = new Set<number>(), disposed = false, signature = '';
  let timer: ReturnType<typeof setInterval> | undefined;
  const running = () => status === 'uploading';
  function publish() {
    if (disposed) return;
    const pending = [...pieces].filter(([index]) => !saved.has(index));
    const uploading = Math.min(options.limit, pending.filter(([, piece]) => !piece.acknowledged).length);
    // Keep an acknowledged ball assigned until uploadedChunks delivers its saved event.
    const indices = pending.slice(0, options.limit).map(([index]) => index);
    const waiting = pending.some(([, piece]) => !piece.acknowledged && now() - piece.since > 10000);
    const next = `${indices.join(',')}|${uploading}|${waiting}`;
    if (next !== signature) {
      signature = next;
      try { onChange({ indices, uploading, waiting }); } catch { /* Optional UI cannot fail an upload. */ }
    }
    if (pending.length && !timer) timer = setInterval(publish, 1000);
    if (!pending.length && timer) { clearInterval(timer); timer = undefined; }
  }
  function timing(index: number, elapsedMs: number, confirmed: boolean) {
    try {
      console.info(`[upload] piece ${index}: ${confirmed ? 'server confirmed' : 'request failed'} after ${Math.round(elapsedMs)} ms`);
      options.onTiming?.({ index, elapsedMs, confirmed });
    } catch { /* Diagnostics cannot affect transport. */ }
  }
  const requestId = client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    if (!disposed && running() && fileId && !config.signal?.aborted) {
      const match = config.url?.match(/^\/api\/upload\/([^/]+)\/chunk\?(.*)$/);
      const index = match ? Number(new URLSearchParams(match[2]).get('chunkIndex')) : NaN;
      if (match?.[1] === fileId && Number.isInteger(index) && index >= 0 && !saved.has(index)) {
        const started = now();
        requests.set(config, { index, started, epoch });
        const piece = pieces.get(index) ?? { since: started, acknowledged: false, attempts: 0 };
        piece.attempts++; pieces.set(index, piece);
        try { console.info(`[upload] piece ${index}: request started`); } catch { /* Optional diagnostics. */ }
        publish();
      }
    }
    return config;
  });
  const responseId = client.interceptors.response.use(response => {
    const request = requests.get(response.config);
    if (request && !disposed && request.epoch === epoch && running()) {
      const piece = pieces.get(request.index);
      if (piece) piece.acknowledged = true;
      timing(request.index, now() - request.started, true);
      publish();
    }
    return response;
  }, (error: unknown) => {
    if (axios.isAxiosError(error) && error.config) {
      const request = requests.get(error.config);
      if (request && !disposed && request.epoch === epoch && running() && !axios.isCancel(error)) {
        timing(request.index, now() - request.started, false);
        if ((pieces.get(request.index)?.attempts ?? 0) >= (options.maxAttempts ?? 3)) pieces.delete(request.index);
        // Retain its assignment during the uploader's retry/backoff cycle.
        publish();
      }
    }
    return Promise.reject(error);
  });
  return {
    update(update: Partial<UploadState>) {
      if (disposed) return;
      if (update.fileId !== undefined && update.fileId !== fileId) {
        epoch++; pieces.clear(); saved.clear(); fileId = update.fileId;
      }
      if (update.status) status = update.status;
      if (update.uploadedChunks) {
        saved = new Set(update.uploadedChunks);
        for (const index of saved) pieces.delete(index);
      }
      if (!running()) { epoch++; pieces.clear(); }
      publish();
    },
    dispose() {
      disposed = true; epoch++; pieces.clear();
      client.interceptors.request.eject(requestId);
      client.interceptors.response.eject(responseId);
      if (timer) clearInterval(timer);
    },
  };
}
