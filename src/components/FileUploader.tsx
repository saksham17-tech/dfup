'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createUploader,
  CHUNK_SIZE,
  MAX_CONCURRENT_UPLOADS,
  type UploadControls,
  type UploadState,
} from '@/lib/upload';
import { Pause, Play, X, RotateCcw, Minus, Maximize2 } from 'lucide-react';
import CourtProgress from './CourtProgress';
import { uploadBridge } from '@/lib/court/uploadBridge';
import { btnAccent, btnPrimary, btnSecondary, formatBytes } from '@/lib/ui';

const PIECE_MB = CHUNK_SIZE / (1024 * 1024);

export default function FileUploader({
  onSuccess,
}: {
  onSuccess?: () => void;
}) {
  const [uploadState, setUploadState] = useState<UploadState>({
    fileId: null,
    status: 'idle',
    progress: 0,
    uploadedBytes: 0,
    totalBytes: 0,
    error: null,
    uploadedChunks: [],
  });
  const [fileName, setFileName] = useState('');
  const [dragging, setDragging] = useState(false);

  const controlsRef = useRef<UploadControls | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keep latest onSuccess without recreating the uploader (which would drop fileId/paused state)
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    controlsRef.current = createUploader((newState) => {
      setUploadState((prev) => ({ ...prev, ...newState }));
      if (newState.status === 'completed') {
        onSuccessRef.current?.();
      }
    });
    return () => controlsRef.current?.abort();
  }, []);

  const startFile = async (file: File) => {
    if (!controlsRef.current) return;
    setFileName(file.name);
    await controlsRef.current.start(file);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again later
    if (file) await startFile(file);
  };

  const { status, totalBytes, uploadedBytes, progress, uploadedChunks, error } =
    uploadState;
  const totalPieces = Math.max(1, Math.ceil(totalBytes / CHUNK_SIZE));
  const savedPieces = uploadedChunks.length;

  const finishing = totalBytes > 0 && uploadedBytes >= totalBytes;
  const courtPhase =
    status === 'processing' || (status === 'uploading' && finishing)
      ? 'finishing'
      : status === 'init'
        ? 'uploading'
        : status;

  // ── Upload events: only indices acknowledged by the server can create a shot ──
  useEffect(() => {
    uploadBridge.reconcile(
      uploadedChunks,
      courtPhase,
      totalPieces,
      uploadState.fileId,
    );
  }, [uploadedChunks, courtPhase, totalPieces, uploadState.fileId]);
  useEffect(() => () => uploadBridge.reset(), []);

  // ── Compact status: the saved count is rendered exactly once ──
  const canRetry = status === 'error' && Boolean(uploadState.fileId);
  const confirming = status === 'processing' || (status === 'uploading' && finishing);
  const statusText = status === 'error' ? error ?? 'The upload stopped. Retry to continue.'
    : confirming ? 'Last piece sent. Confirming with the server…'
    : status === 'init' ? 'Preparing your upload…'
    : `${status === 'paused' ? 'Paused · ' : ''}${savedPieces} of ${totalPieces} saved · ${formatBytes(uploadedBytes)} of ${formatBytes(totalBytes)}`;
  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    try { setMinimized(sessionStorage.getItem('vault-upload-minimized') === 'true'); } catch { /* Storage may be disabled. */ }
  }, []);
  const toggleMinimized = () => setMinimized(current => {
    try { sessionStorage.setItem('vault-upload-minimized', String(!current)); } catch { /* Uploads never depend on storage. */ }
    return !current;
  });

  // ── Whole-window file drop, including the empty court around the dock ──
  useEffect(() => {
    let depth = 0;
    const isFile = (event: DragEvent) => event.dataTransfer?.types.includes('Files');
    const enter = (event: DragEvent) => { if (isFile(event)) { event.preventDefault(); if (status === 'idle') { depth++; setDragging(true); } } };
    const over = (event: DragEvent) => { if (isFile(event)) event.preventDefault(); };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const drop = (event: DragEvent) => {
      if (!isFile(event)) return;
      event.preventDefault(); depth = 0; setDragging(false);
      const file = event.dataTransfer?.files[0];
      if (file && status === 'idle') void startFile(file);
    };
    window.addEventListener('dragenter', enter); window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  }, [status]);

  const pauseResume = status === 'paused' ? (
    <button type="button" aria-label="Resume upload" className={`${btnSecondary} upload-action`} onClick={() => controlsRef.current?.resume()}><Play className="h-3.5 w-3.5" /><span>Resume</span></button>
  ) : status === 'uploading' ? (
    <button type="button" aria-label="Pause upload" className={`${btnSecondary} upload-action`} onClick={() => controlsRef.current?.pause()}><Pause className="h-3.5 w-3.5" /><span>Pause</span></button>
  ) : null;
  const cancel = status !== 'idle' && status !== 'completed' ? (
    <button type="button" aria-label="Cancel upload" title="Cancel upload" className={`${btnSecondary} upload-action upload-icon`} onClick={() => controlsRef.current?.abort()}><X className="h-3.5 w-3.5" /></button>
  ) : null;
  const pill = minimized && status !== 'error' && !confirming;
  return (
    <section aria-label="Upload a file">
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} tabIndex={-1} />
      {dragging && <div className="court-drop-highlight" aria-hidden="true" />}
      <div data-court-avoid className={`upload-dock court-glass ${pill ? 'upload-pill' : ''}`}>
        {pill ? (
          <>
            {status === 'idle' ? <button type="button" className={`${btnPrimary} upload-action`} onClick={() => fileInputRef.current?.click()}>Choose file</button>
              : <span role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="px-1 text-sm font-semibold tabular-nums">{Math.round(progress)}%</span>}
            {status === 'uploading' || status === 'paused' ? <button type="button" aria-label={status === 'paused' ? 'Resume upload' : 'Pause upload'} className={`${btnSecondary} upload-action upload-icon`} onClick={() => status === 'paused' ? controlsRef.current?.resume() : controlsRef.current?.pause()}>{status === 'paused' ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}</button> : null}
            {cancel}
            {status === 'completed' && <button type="button" aria-label="Upload another file" title="Upload another file" className={`${btnSecondary} upload-action upload-icon`} onClick={() => controlsRef.current?.abort()}><RotateCcw className="h-3.5 w-3.5" /></button>}
            <button type="button" aria-label="Expand upload bar" title="Expand upload bar" className={`${btnSecondary} upload-action upload-icon`} onClick={toggleMinimized}><Maximize2 className="h-3.5 w-3.5" /></button>
            <span className="sr-only" aria-live="polite">{status === 'idle' ? 'Drop a file anywhere or choose file' : statusText}</span>
          </>
        ) : status === 'idle' ? (
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-sm text-ink">Drop a file or <button type="button" className="font-semibold text-cobalt underline underline-offset-4" onClick={() => fileInputRef.current?.click()}>Choose file</button><span className="ml-2 hidden text-xs text-muted sm:inline">{PIECE_MB} MB pieces</span></p>
            <button type="button" aria-label="Minimize upload bar" title="Minimize upload bar" className={`${btnSecondary} upload-action upload-icon`} onClick={toggleMinimized}><Minus className="h-3.5 w-3.5" /></button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold" title={fileName}>{fileName || 'Your file'}</h2>
                <p aria-live="polite" className={`upload-status ${status === 'error' ? 'text-alert' : 'text-muted'}`}>{statusText}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className="mr-1 text-sm font-semibold tabular-nums">{Math.round(progress)}%</span>
                {pauseResume}
                {canRetry && <button type="button" className={`${btnAccent} upload-action`} onClick={() => controlsRef.current?.resume()}><RotateCcw className="h-3.5 w-3.5" />Retry</button>}
                {status === 'completed' && <button type="button" className={`${btnSecondary} upload-action`} onClick={() => controlsRef.current?.abort()}><RotateCcw className="h-3.5 w-3.5" /><span>Upload another file</span></button>}
                {cancel}
                <button type="button" aria-label="Minimize upload bar" title="Minimize upload bar" className={`${btnSecondary} upload-action upload-icon`} onClick={toggleMinimized}><Minus className="h-3.5 w-3.5" /></button>
              </div>
            </div>
            <CourtProgress totalPieces={totalPieces} savedIndices={uploadedChunks} phase={courtPhase} compact inFlightCount={status === 'uploading' && !finishing ? Math.min(MAX_CONCURRENT_UPLOADS, totalPieces - savedPieces) : 0} label="Upload progress" progress={progress} />
          </>
        )}
      </div>
    </section>
  );
}
