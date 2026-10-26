'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Download, X } from 'lucide-react';
import { btnSecondary, formatBytes } from '@/lib/ui';

type RecentFile = { id: string; filename: string; totalSize: number };

// ── A native modal drawer owns focus trapping, Escape and the top layer ──
export default function RecentFiles({ refreshSignal }: { refreshSignal: number }) {
  const [files, setFiles] = useState<RecentFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const drawer = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch('/api/upload/files/list', { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('Could not load recent files.'); return response.json() as Promise<RecentFile[]>; })
      .then(data => { setFiles(Array.isArray(data) ? data : []); setError(null); })
      .catch((failure: unknown) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load recent files.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshSignal]);
  useEffect(() => { const element = drawer.current; return () => element?.close(); }, []);
  return (
    <>
      <button ref={trigger} type="button" className={`${btnSecondary} court-glass recent-trigger bg-surface/80`}
        aria-haspopup="dialog" aria-controls="recent-files-drawer" onClick={() => drawer.current?.showModal()}>
        Recent files ({loading ? '…' : files.length})
      </button>
      <dialog ref={drawer} id="recent-files-drawer" className="recent-drawer court-glass" aria-labelledby="recent-files-title"
        onClose={() => trigger.current?.focus()}>
        <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
          <h2 id="recent-files-title" className="font-display text-xl font-semibold">Recent files</h2>
          <button type="button" aria-label="Close recent files" className={`${btnSecondary} upload-action upload-icon`} onClick={() => drawer.current?.close()}><X className="h-4 w-4" /></button>
        </div>
        {loading && <p className="mt-5 text-sm text-muted" role="status">Loading files…</p>}
        {error && <p className="mt-5 text-sm text-alert" role="alert">{error}</p>}
        {!loading && !error && files.length === 0 && <p className="mt-5 text-sm text-muted">No files yet. Upload one to see it here.</p>}
        <ul className="my-3 divide-y divide-line">
          {files.slice(0, 5).map(file => <li key={file.id} className="flex items-center justify-between gap-3 py-4">
            <div className="min-w-0"><p className="truncate text-sm font-medium" title={file.filename}>{file.filename}</p><p className="text-xs tabular-nums text-muted">{formatBytes(file.totalSize)}</p></div>
            <a href={`/api/upload/files/${file.id}/download`} className={`${btnSecondary} upload-action upload-icon`} aria-label={`Download ${file.filename}`}><Download className="h-4 w-4" /></a>
          </li>)}
        </ul>
        <Link href="/dashboard?view=files" className="mt-auto pt-5 text-sm font-medium text-cobalt underline underline-offset-4" onClick={() => drawer.current?.close()}>See all files</Link>
      </dialog>
    </>
  );
}
