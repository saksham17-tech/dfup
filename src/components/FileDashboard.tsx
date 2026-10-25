'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Trash2, RefreshCw, RotateCcw } from 'lucide-react';
import {
  btnDanger,
  btnPrimary,
  btnSecondary,
  btnSmall,
  formatBytes,
  formatDate,
} from '@/lib/ui';

type Quota = {
  usedBytes: number;
  fileCount: number;
};

type FileRow = {
  id: string;
  filename: string;
  totalSize: number;
  mimeType: string;
  storagePath: string | null;
  createdAt: string;
  deletedAt?: string | null;
  downloadUrl: string | null;
};

type Pending = { file: FileRow; permanentOnly: boolean };

function extension(name: string) {
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1
    ? name.slice(i + 1, i + 5).toLowerCase()
    : 'file';
}

type Props = {
  /** Heading shown above the list. Omit when the page already has an h1. */
  title?: string;
  /** Show only the newest N files. */
  limit?: number;
  /** When true, list soft-deleted files and show restore/permanent actions */
  isBin?: boolean;
  refreshSignal?: number;
  footer?: React.ReactNode;
};

const ROW_GRID =
  'grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 sm:grid-cols-[2.5rem_minmax(0,1fr)_6rem_11rem_auto]';

export default function FileDashboard({
  title,
  limit,
  isBin = false,
  refreshSignal = 0,
  footer,
}: Props) {
  const [quota, setQuota] = useState<Quota | null>(null);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const listUrl = isBin
        ? '/api/upload/files/list?bin=1'
        : '/api/upload/files/list';
      const [qRes, fRes] = await Promise.all([
        isBin
          ? Promise.resolve(
              new Response(JSON.stringify({ usedBytes: 0, fileCount: 0 }), {
                status: 200,
              }),
            )
          : fetch('/api/upload/usage/quota'),
        fetch(listUrl),
      ]);
      if (!qRes.ok)
        throw new Error((await qRes.text()) || `Quota ${qRes.status}`);
      if (!fRes.ok)
        throw new Error((await fRes.text()) || `List ${fRes.status}`);
      setQuota((await qRes.json()) as Quota);
      const f = (await fRes.json()) as FileRow[];
      setFiles(Array.isArray(f) ? f : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isBin]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshSignal, isBin]);

  // Dialog: focus Cancel on open, close on Escape
  useEffect(() => {
    if (!pending) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setPending(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, busy]);

  async function run(request: () => Promise<Response>, failure: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await request();
      if (!res.ok) throw new Error((await res.text()) || failure);
      setPending(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  const moveToBin = () =>
    pending &&
    run(
      () => fetch(`/api/upload/files/${pending.file.id}`, { method: 'DELETE' }),
      'Could not move the file to the bin',
    );

  const deletePermanent = () =>
    pending &&
    run(
      () =>
        fetch(`/api/upload/files/${pending.file.id}?permanent=true`, {
          method: 'DELETE',
        }),
      'Could not delete the file',
    );

  const restore = (f: FileRow) =>
    run(
      () =>
        fetch(`/api/upload/files/${f.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'restore' }),
        }),
      'Could not restore the file',
    );

  const visible = limit ? files.slice(0, limit) : files;

  return (
    <>
      <section aria-label={title ?? (isBin ? 'Deleted files' : 'Files')}>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            {title && (
              <h2 className="font-display text-2xl font-semibold tracking-tight">
                {title}
              </h2>
            )}
            {!isBin && quota && (
              <p className="mt-1 text-sm tabular-nums text-muted">
                {formatBytes(quota.usedBytes)} used across {quota.fileCount}{' '}
                {quota.fileCount === 1 ? 'file' : 'files'}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className={`${btnSecondary} ${btnSmall}`}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`}
            />
            Refresh
          </button>
        </div>

        {error && (
          <p
            role="alert"
            className="mb-4 rounded-md border border-alert/30 bg-alert-soft px-3 py-2 text-sm text-alert"
          >
            {error}
          </p>
        )}

        {!loading && visible.length === 0 && !error && (
          <div className="rounded-lg border border-dashed border-line px-6 py-12 text-center">
            <p className="font-display text-lg font-semibold">
              {isBin ? 'The bin is empty' : 'No files yet'}
            </p>
            <p className="mt-1 text-sm text-muted">
              {isBin
                ? 'Files you delete will wait here before they are removed.'
                : 'Upload a file and it will show up here.'}
            </p>
          </div>
        )}

        {loading && visible.length === 0 && (
          <p className="py-10 text-center text-sm text-muted" aria-busy="true">
            Loading files…
          </p>
        )}

        {visible.length > 0 && (
          <div className="court-glass overflow-hidden rounded-lg border border-line bg-surface/80">
            <div
              className={`${ROW_GRID} hidden border-b border-line px-4 py-2 text-sm text-muted sm:grid`}
            >
              <span className="col-span-2">Name</span>
              <span>Size</span>
              <span>{isBin ? 'Deleted' : 'Added'}</span>
              <span className="sr-only">Actions</span>
            </div>

            <ul className="m-0 list-none p-0">
              {visible.map((f) => {
                const when = isBin && f.deletedAt ? f.deletedAt : f.createdAt;
                return (
                  <li
                    key={f.id}
                    className={`${ROW_GRID} gap-y-0 border-b border-line px-4 py-3 last:border-b-0`}
                  >
                    <span
                      aria-hidden="true"
                      className="grid h-10 w-10 place-items-center rounded-md bg-paper text-xs font-medium text-muted"
                    >
                      {extension(f.filename)}
                    </span>

                    <div className="min-w-0">
                      <p
                        className="truncate text-sm font-medium"
                        title={f.filename}
                      >
                        {f.filename}
                      </p>
                      <p className="mt-0.5 text-xs tabular-nums text-muted sm:hidden">
                        {formatBytes(f.totalSize)}
                        {when ? `, ${formatDate(when)}` : ''}
                      </p>
                    </div>

                    <span className="hidden text-sm tabular-nums text-muted sm:block">
                      {formatBytes(f.totalSize)}
                    </span>
                    <span className="hidden text-sm tabular-nums text-muted sm:block">
                      {when ? formatDate(when) : ''}
                    </span>

                    <div className="flex items-center gap-2">
                      {isBin ? (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => restore(f)}
                            className={`${btnSecondary} ${btnSmall}`}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Restore
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              setPending({ file: f, permanentOnly: true })
                            }
                            aria-label={`Delete ${f.filename} permanently`}
                            className={`${btnDanger} ${btnSmall}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Delete</span>
                          </button>
                        </>
                      ) : (
                        <>
                          <a
                            href={`/api/upload/files/${f.id}/download`}
                            aria-label={`Download ${f.filename}`}
                            className={`${btnSecondary} ${btnSmall}`}
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Download</span>
                          </a>
                          <button
                            type="button"
                            onClick={() =>
                              setPending({ file: f, permanentOnly: false })
                            }
                            aria-label={`Delete ${f.filename}`}
                            className={`${btnSecondary} ${btnSmall} hover:border-alert/40 hover:text-alert`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {footer && visible.length > 0 && <div className="mt-4">{footer}</div>}
      </section>

      {pending && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
          onClick={() => !busy && setPending(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-xl"
          >
            <h3
              id="delete-title"
              className="font-display text-xl font-semibold tracking-tight"
            >
              {pending.permanentOnly
                ? 'Delete permanently?'
                : 'Delete this file?'}
            </h3>
            <p
              className="mt-1 truncate text-sm font-medium"
              title={pending.file.filename}
            >
              {pending.file.filename}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              {pending.permanentOnly
                ? 'This removes the file now. It can’t be restored.'
                : 'Move to bin keeps the file for 5 days so you can restore it. Delete permanently removes it now and can’t be undone.'}
            </p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                ref={cancelRef}
                type="button"
                disabled={busy}
                onClick={() => setPending(null)}
                className={btnSecondary}
              >
                Cancel
              </button>
              {!pending.permanentOnly && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={moveToBin}
                  className={btnPrimary}
                >
                  {busy ? 'Working…' : 'Move to bin'}
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={deletePermanent}
                className={btnDanger}
              >
                {busy ? 'Working…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
