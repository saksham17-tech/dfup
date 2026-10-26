/**
 * Resumable chunked upload utilities (Next.js App Router).
 * Same-origin /api/upload/* · 4 MB chunks · concurrent pool · axios byte progress
 * · 180 s timeout · 3× exponential backoff per chunk
 */

import axios, { AxiosError, type AxiosProgressEvent } from 'axios';

export const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB (under Vercel 4.5 MB limit)

/** How many chunk uploads may be in flight at once */
export const MAX_CONCURRENT_UPLOADS = 5;

/** @deprecated use MAX_CONCURRENT_UPLOADS */
export const MAX_CONCURRENCY = MAX_CONCURRENT_UPLOADS;

/** Per-chunk network timeout */
export const CHUNK_TIMEOUT_MS = 180_000; // 3 minutes

/** Max attempts per chunk before surfacing a recoverable error */
export const MAX_CHUNK_RETRIES = 3;

/** Same-origin API base (Next.js Route Handlers) */
const API = '/api/upload';

export type UploadState = {
  fileId: string | null;
  status: 'idle' | 'init' | 'uploading' | 'processing' | 'paused' | 'completed' | 'error';
  progress: number; // 0–100 (byte-level smooth)
  uploadedBytes: number;
  totalBytes: number;
  error: string | null;
  uploadedChunks: number[];
};

export type UploadControls = {
  start: (file: File) => Promise<void>;
  pause: () => void;
  resume: () => Promise<void>;
  abort: (discard?: boolean) => void;
};

type ChunkMeta = {
  index: number;
  blob: Blob;
  start: number;
  end: number;
  size: number;
};

/** SHA-256 hex digest of an ArrayBuffer / Blob */
export async function sha256(data: ArrayBuffer | Blob): Promise<string> {
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Split a File into 4 MB Blob slices with metadata */
export function sliceFile(file: File) {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE) || 1;
  const chunks: ChunkMeta[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    chunks.push({
      index: i,
      blob: file.slice(start, end),
      start,
      end,
      size: end - start,
    });
  }

  return { totalChunks, chunks };
}

async function apiInit(file: File, totalChunks: number, token: string | null) {
  const res = await fetch(`${API}/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({
      filename: file.name,
      totalSize: file.size,
      totalChunks,
      mimeType: file.type || 'application/octet-stream',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Init failed (${res.status})`);
  }
  return res.json() as Promise<{ fileId: string; resumed?: boolean }>;
}

async function apiStatus(fileId: string) {
  const res = await fetch(`${API}/${fileId}/status`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Status failed (${res.status})`);
  return res.json() as Promise<{
    status: string;
    totalChunks: number;
    uploadedChunks: number[];
    checksums?: Record<string, string>;
  }>;
}

async function apiComplete(fileId: string, signal: AbortSignal) {
  try {
    const { data } = await axios.post<{ completed?: boolean }>(`${API}/${fileId}/complete`, null, {
      signal, timeout: CHUNK_TIMEOUT_MS,
    });
    if (data.completed !== true) throw new Error('The server did not confirm the upload. Retry to finish it.');
  } catch (error: unknown) {
    if (axios.isCancel(error)) throw new DOMException('Upload cancelled', 'AbortError');
    if (axios.isAxiosError<{ error?: string }>(error)) {
      throw new Error(error.response?.data?.error || error.message || 'Could not confirm the upload. Retry to finish it.');
    }
    throw error;
  }
}

/**
 * Upload one chunk via axios so we get continuous onUploadProgress events.
 * Timeout + AbortSignal still apply. Timer not needed — axios timeout covers it.
 */
async function apiChunkOnce(
  fileId: string,
  chunkIndex: number,
  checksum: string,
  blob: Blob,
  externalSignal: AbortSignal | undefined,
  onByteProgress: (loaded: number) => void,
): Promise<unknown> {
  const form = new FormData();
  form.append('chunk', blob, `chunk-${chunkIndex}`);

  try {
    const res = await axios.post(
      `${API}/${fileId}/chunk?chunkIndex=${chunkIndex}&checksum=${checksum}&deferCompletion=1`,
      form,
      {
        timeout: CHUNK_TIMEOUT_MS,
        signal: externalSignal,
        // Do NOT set Content-Type — browser must add multipart boundary.
        // Wrong Content-Type often disables reliable onUploadProgress.
        onUploadProgress: (evt: AxiosProgressEvent) => {
          const loaded = evt.loaded ?? 0;
          const total = evt.total && evt.total > 0 ? evt.total : undefined;
          // Scale FormData overhead down to pure chunk-byte progress
          if (total) {
            onByteProgress((loaded / total) * blob.size);
          } else {
            onByteProgress(Math.min(loaded, blob.size));
          }
        },
      },
    );
    // Ensure UI shows 100% for this chunk
    onByteProgress(blob.size);
    return res.data;
  } catch (err: unknown) {
    if (axios.isCancel(err) || (err as AxiosError)?.code === 'ERR_CANCELED') {
      throw new DOMException('Upload paused or cancelled', 'AbortError');
    }
    const ax = err as AxiosError;
    if (ax.code === 'ECONNABORTED' || ax.message?.includes('timeout')) {
      throw new Error(
        `Chunk ${chunkIndex} timed out after ${CHUNK_TIMEOUT_MS / 1000}s`,
      );
    }
    const msg =
      (typeof ax.response?.data === 'string'
        ? ax.response.data
        : (ax.response?.data as { error?: string })?.error) ||
      ax.message ||
      `Chunk ${chunkIndex} failed`;
    throw new Error(msg);
  }
}

/**
 * Retry wrapper: up to MAX_CHUNK_RETRIES with exponential backoff.
 */
async function apiChunkWithRetry(
  fileId: string,
  chunkIndex: number,
  checksum: string,
  blob: Blob,
  externalSignal: AbortSignal | undefined,
  isUserAbort: () => boolean,
  onByteProgress: (loaded: number) => void,
): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_CHUNK_RETRIES; attempt++) {
    if (isUserAbort()) {
      throw new DOMException('Upload paused or cancelled', 'AbortError');
    }

    try {
      // Reset this chunk's progress on each attempt
      onByteProgress(0);
      return await apiChunkOnce(
        fileId,
        chunkIndex,
        checksum,
        blob,
        externalSignal,
        onByteProgress,
      );
    } catch (err: unknown) {
      lastError = err;

      if (
        isUserAbort() ||
        (err instanceof DOMException && err.name === 'AbortError')
      ) {
        throw err;
      }

      if (attempt < MAX_CHUNK_RETRIES) {
        const delayMs = 1000 * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Chunk ${chunkIndex} failed after ${MAX_CHUNK_RETRIES} retries`);
}

/**
 * Sliding-window concurrency pool (max `limit` in flight).
 * First hard failure clears the queue and rethrows.
 */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  shouldStop: () => boolean,
): Promise<void> {
  if (items.length === 0) return;

  const queue = [...items];
  let fatal: unknown = null;
  const inFlight = new Set<Promise<void>>();

  const launch = (): void => {
    while (
      inFlight.size < limit &&
      queue.length > 0 &&
      !fatal &&
      !shouldStop()
    ) {
      const item = queue.shift()!;
      const p = worker(item)
        .catch((err) => {
          if (!fatal) fatal = err;
          queue.length = 0;
        })
        .finally(() => {
          inFlight.delete(p);
        });
      inFlight.add(p);
    }
  };

  launch();

  while (inFlight.size > 0) {
    await Promise.race(inFlight);
    if (fatal || shouldStop()) {
      await Promise.allSettled([...inFlight]);
      break;
    }
    launch();
  }

  if (fatal) throw fatal;
}

/**
 * High-level uploader with concurrent pool + smooth byte-level progress.
 */
/**
 * High-level uploader with concurrent pool + smooth byte-level progress.
 *
 * Progress model (avoids 4 MB stair-steps):
 *   loadedBytes =
 *     sum(size of completed chunks) +
 *     sum(activeChunkBytes values for in-flight chunks)
 *   Cap at file.size. Fire on every axios onUploadProgress tick.
 */
export function createUploader(
  onUpdate: (state: Partial<UploadState>) => void,
  accessToken: () => Promise<string | null> = async () => null,
): UploadControls {
  let aborted = false;
  let paused = false;
  let poolController: AbortController | null = null;
  let generation = 0;
  let pendingRun: Promise<void> = Promise.resolve();
  type Selection = { file: File; id: string | null; token: string | null; verify: boolean; hashes: Map<number, string> };
  let selection: Selection | null = null;

  const set = (partial: Partial<UploadState>) => onUpdate(partial);
  const isUserAbort = () => aborted || paused;

  async function uploadMissing(file: File, id: string, run: number, selected: Selection) {
    const shouldStop = () => isUserAbort() || run !== generation;
    const { chunks } = sliceFile(file);
    const status = await apiStatus(id);
    if (shouldStop()) return;
    if (status.totalChunks !== chunks.length) throw new Error('The stored upload does not match this file. Upload the file again.');
    const completed = new Set<number>();
    for (const index of status.uploadedChunks) {
      if (!Number.isInteger(index) || index < 0 || index >= chunks.length) continue;
      if (selected.verify) {
        const hash = selected.hashes.get(index) ?? await sha256(chunks[index].blob);
        if (shouldStop()) return;
        selected.hashes.set(index, hash);
        if (hash !== status.checksums?.[String(index)]) continue;
      }
      completed.add(index);
    }
    console.info(`[upload] resuming ${id}: ${completed.size}/${chunks.length} pieces already on the server${selected.verify ? ' (checksum verified)' : ''}`);
    if (status.status === 'COMPLETED' && completed.size !== chunks.length)
      throw new Error('This upload completed with different content. Choose the file again to start a separate upload.');

    // Bytes already fully accepted by the server (by chunk index)
    const completedBytesByIndex = new Map<number, number>();
    for (const idx of completed) {
      const c = chunks.find((x) => x.index === idx);
      if (c) completedBytesByIndex.set(idx, c.size);
    }

    // Mid-flight: chunkIndex → bytes streamed so far (from onUploadProgress)
    const activeChunkBytes = new Map<number, number>();

    // rAF-throttle React updates so the bar glides instead of thrashing
    let rafId = 0;
    let pendingEmit = false;

    const computeLoaded = () => {
      let completedSum = 0;
      for (const v of completedBytesByIndex.values()) completedSum += v;
      let activeSum = 0;
      for (const v of activeChunkBytes.values()) activeSum += v;
      return Math.min(file.size, completedSum + activeSum);
    };

    const reportProgress = () => {
      if (shouldStop()) return;
      const loadedBytes = computeLoaded();
      set({
        uploadedBytes: loadedBytes,
        progress: Math.min(100, (loadedBytes / file.size) * 100),
        uploadedChunks: [...completed],
      });
    };

    const scheduleProgress = () => {
      if (pendingEmit || shouldStop()) return;
      pendingEmit = true;
      rafId = requestAnimationFrame(() => {
        pendingEmit = false;
        reportProgress();
      });
    };

    set({
      status: 'uploading',
      error: null,
      uploadedChunks: [...completed],
    });
    reportProgress();

    const pending = status.status === 'COMPLETED' ? [] : chunks.filter((c) => !completed.has(c.index));
    const controller = new AbortController();
    poolController = controller;

    try {
      await runPool(
        pending,
        MAX_CONCURRENT_UPLOADS,
        async (item) => {
          if (shouldStop()) {
            throw new DOMException('Upload paused or cancelled', 'AbortError');
          }

          const checksum = selected.hashes.get(item.index) ?? await sha256(item.blob);
          if (shouldStop()) throw new DOMException('Upload paused or cancelled', 'AbortError');
          selected.hashes.set(item.index, checksum);

          // Mark chunk as active at 0 before the request starts
          activeChunkBytes.set(item.index, 0);
          scheduleProgress();

          try {
            await apiChunkWithRetry(
              id,
              item.index,
              checksum,
              item.blob,
              controller.signal,
              shouldStop,
              (loaded) => {
                // Cap at pure chunk size (FormData overhead already scaled in apiChunkOnce)
                activeChunkBytes.set(
                  item.index,
                  Math.min(Math.max(0, loaded), item.size),
                );
                scheduleProgress();
              },
            );
          } finally {
            // Leave active map whether success or failure of this attempt cycle
          }

          // Success: move from active → completed
          activeChunkBytes.delete(item.index);
          completed.add(item.index);
          completedBytesByIndex.set(item.index, item.size);
          scheduleProgress();
        },
        shouldStop,
      );
    } finally {
      if (rafId) cancelAnimationFrame(rafId);
      activeChunkBytes.clear();
    }

    if (shouldStop()) return;

    const confirmed = await apiStatus(id);
    if (shouldStop()) return;
    const saved = new Set(confirmed.uploadedChunks);
    if (chunks.some(chunk => !saved.has(chunk.index)))
      throw new Error('The server still reports missing pieces. Retry to send them.');
    if (selected.verify && chunks.some(chunk => confirmed.checksums?.[String(chunk.index)] !== selected.hashes.get(chunk.index)))
      throw new Error('Saved piece checksums changed during the upload. Retry to verify and replace them.');

    // Completion is an explicit acknowledgement, not an assumption based on byte progress.
    set({
      status: 'processing',
      progress: 100,
      uploadedBytes: file.size,
      uploadedChunks: [...completed],
    });

    await apiComplete(id, controller.signal);
    if (shouldStop()) return;
    set({ status: 'completed', progress: 100, uploadedBytes: file.size,
      uploadedChunks: chunks.map((chunk) => chunk.index) });
  }

  function runAfterPrevious(work: (run: number) => Promise<void>): Promise<void> {
    const run = ++generation;
    poolController?.abort();
    const previous = pendingRun;
    const task = (async () => {
      await previous;
      if (run !== generation) return;
      try { await work(run); }
      catch (error: unknown) {
        if (aborted || paused || run !== generation) return;
        set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    })();
    pendingRun = task;
    return task;
  }

  return {
    start(file: File) {
      aborted = false;
      paused = false;
      const selected: Selection = { file, id: null, token: null, verify: false, hashes: new Map() };
      selection = selected;

      set({
        status: 'init',
        progress: 0,
        uploadedBytes: 0,
        totalBytes: file.size,
        error: null,
        uploadedChunks: [],
        fileId: null,
      });

      return runAfterPrevious(async run => {
        selected.token = await accessToken();
        if (run !== generation) return;
        const { totalChunks } = sliceFile(file);
        const { fileId: id, resumed } = await apiInit(file, totalChunks, selected.token);
        // Keep a late init ID for Cancel's deferred discard, even when superseded.
        selected.id = id;
        selected.verify = Boolean(resumed);
        if (run !== generation || isUserAbort()) return;
        set({ fileId: id, status: resumed ? 'init' : 'uploading' });
        await uploadMissing(file, id, run, selected);
      });
    },

    pause() {
      generation++;
      paused = true;
      poolController?.abort();
      set({ status: 'paused', error: null });
    },

    resume() {
      const selected = selection;
      if (!selected) return Promise.resolve();
      paused = false;
      aborted = false;
      set({ status: selected.verify ? 'init' : 'uploading', error: null });
      return runAfterPrevious(async run => {
        if (!selected.id) throw new Error('The upload was not initialized. Choose the file again.');
        set({ fileId: selected.id });
        await uploadMissing(selected.file, selected.id, run, selected);
      });
    },

    abort(discard = true) {
      generation++;
      aborted = true;
      paused = false;
      poolController?.abort();
      const selected = selection;
      selection = null;
      if (discard && selected) {
        // Let previous requests unwind (including a late init) before deleting.
        // Keep navigation cleanup non-destructive by calling abort(false).
        const cleanup = pendingRun.then(async () => {
          if (!selected.id) return;
          const token = await accessToken() ?? selected.token;
          const response = await fetch(`${API}/${selected.id}`, {
            method: 'DELETE', keepalive: true,
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!response.ok && ![404, 409].includes(response.status))
            throw new Error(`Discard failed (${response.status}); operator cleanup may be needed.`);
        }).catch((error: unknown) => console.warn('[upload] could not discard unfinished upload', error));
        pendingRun = cleanup;
      }
      set({
        status: 'idle',
        progress: 0,
        uploadedBytes: 0,
        totalBytes: 0,
        fileId: null,
        error: null,
        uploadedChunks: [],
      });
    },
  };
}
