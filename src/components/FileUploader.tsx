'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createUploader,
  CHUNK_SIZE,
  MAX_CONCURRENT_UPLOADS,
  type UploadControls,
  type UploadState,
} from '@/lib/upload';
import { Pause, Play, X, RotateCcw, Check } from 'lucide-react';
import CourtProgress from './CourtProgress';
import {
  btnAccent,
  btnPrimary,
  btnSecondary,
  formatBytes,
} from '@/lib/ui';

const PIECE_MB = CHUNK_SIZE / (1024 * 1024);

export default function FileUploader({ onSuccess }: { onSuccess?: () => void }) {
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

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await startFile(file);
  };

  const { status, totalBytes, uploadedBytes, progress, uploadedChunks, error } =
    uploadState;
  const totalPieces = Math.max(1, Math.ceil(totalBytes / CHUNK_SIZE));
  const savedPieces = uploadedChunks.length;

  const finishing = totalBytes > 0 && uploadedBytes >= totalBytes;
  const courtPhase = status === 'processing' || (status === 'uploading' && finishing)
    ? 'finishing' : status === 'init' ? 'uploading' : status;

  const statusLine: Record<UploadState['status'], string> = {
    idle: '',
    init: 'Preparing your upload…',
    uploading: `${savedPieces} of ${totalPieces} pieces saved`,
    processing: 'All pieces arrived. Putting the file together on the server…',
    paused: `Paused. ${savedPieces} of ${totalPieces} pieces are saved, and Resume sends only the rest.`,
    completed: 'Done. Your file is in My files.',
    error: error ?? 'The upload stopped.',
  };

  const canRetry = status === 'error' && Boolean(uploadState.fileId);

  return (
    <section aria-label="Upload a file">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
        tabIndex={-1}
      />

      {status === 'idle' ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`rounded-lg border border-dashed p-6 transition-colors motion-reduce:transition-none sm:p-10 ${
            dragging ? 'border-cobalt bg-cobalt-soft' : 'border-line bg-surface'
          }`}
        >
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Drop a file here
          </h2>
          <p className="mt-3 max-w-prose text-muted">
            Files go up in {PIECE_MB} MB pieces. If you pause or a request
            fails, Vault sends only the pieces that are still missing.
          </p>
          <div className="mt-8">
            <CourtProgress totalPieces={48} savedIndices={[]} phase="idle"
              label="Ready to upload" progress={0} variant="compact" />
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={btnPrimary}
            >
              Choose file
            </button>
            <span className="text-sm text-muted">or drag it onto this panel</span>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-line bg-surface p-5 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <h2
              className="min-w-0 truncate font-display text-xl font-semibold sm:text-2xl"
              title={fileName}
            >
              {fileName || 'Your file'}
            </h2>
            <p className="shrink-0 font-display text-3xl font-semibold tabular-nums sm:text-4xl">
              {Math.round(progress)}%
            </p>
          </div>

          <div className="mt-6">
            <CourtProgress
              totalPieces={totalPieces}
              savedIndices={uploadedChunks}
              phase={courtPhase}
              inFlightCount={status === 'uploading' && !finishing
                ? Math.min(MAX_CONCURRENT_UPLOADS, totalPieces - savedPieces) : 0}
              label="Upload progress"
              progress={progress}
            />
            <p className="mt-2 text-xs tabular-nums text-muted">
              {savedPieces} of {totalPieces} pieces scored
            </p>
          </div>

          <div className="mt-4 flex flex-col justify-between gap-1 sm:flex-row sm:gap-6">
            <p
              aria-live="polite"
              className={`max-w-prose text-sm ${status === 'error' ? 'text-alert' : 'text-muted'}`}
            >
              {statusLine[status]}
            </p>
            <p className="shrink-0 text-sm tabular-nums text-muted">
              {formatBytes(uploadedBytes)} of {formatBytes(totalBytes)}
            </p>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {status === 'uploading' && (
              <button
                type="button"
                onClick={() => controlsRef.current?.pause()}
                className={btnSecondary}
              >
                <Pause className="h-4 w-4" />
                Pause
              </button>
            )}

            {status === 'paused' && (
              <button
                type="button"
                onClick={() => controlsRef.current?.resume()}
                className={btnAccent}
              >
                <Play className="h-4 w-4" />
                Resume
              </button>
            )}

            {canRetry && (
              <button
                type="button"
                onClick={() => controlsRef.current?.resume()}
                className={btnAccent}
              >
                <RotateCcw className="h-4 w-4" />
                Retry
              </button>
            )}

            {(status === 'uploading' ||
              status === 'paused' ||
              status === 'error') && (
              <button
                type="button"
                onClick={() => controlsRef.current?.abort()}
                className={btnSecondary}
              >
                <X className="h-4 w-4" />
                Cancel upload
              </button>
            )}

            {status === 'completed' && (
              <>
                <span className="inline-flex items-center gap-2 text-sm font-medium text-cobalt">
                  <Check className="h-4 w-4" />
                  Upload complete
                </span>
                <button
                  type="button"
                  onClick={() => controlsRef.current?.abort()}
                  className={btnPrimary}
                >
                  Upload another file
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
