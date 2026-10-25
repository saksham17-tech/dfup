'use client';

import { useState, useRef, useEffect } from 'react';
import { createUploader, UploadControls, UploadState } from '@/lib/upload';
import { Play, Pause, X, CheckCircle, AlertCircle, UploadCloud } from 'lucide-react';

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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !controlsRef.current) return;
    await controlsRef.current.start(file);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur-md">
      {uploadState.status === 'idle' ? (
        <div 
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-700 p-8 transition-colors hover:border-blue-500 cursor-pointer"
        >
          <UploadCloud className="mb-3 h-10 w-10 text-zinc-400" />
          <p className="text-sm font-medium text-zinc-200">Click to upload or drag and drop</p>
          <p className="mt-1 text-xs text-zinc-500">Supports chunked resumable uploads (4MB chunks)</p>
          <input 
            ref={fileInputRef}
            type="file" 
            className="hidden" 
            onChange={handleFileChange}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-200 capitalize">
              Status: <strong className="text-blue-400">{uploadState.status}</strong>
            </span>
            <span className="text-xs text-zinc-400">
              {formatBytes(uploadState.uploadedBytes)} / {formatBytes(uploadState.totalBytes)} ({Math.round(uploadState.progress)}%)
            </span>
          </div>

          {/* Progress Bar */}
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
            <div 
              className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-150"
              style={{ width: `${uploadState.progress}%` }}
            />
          </div>

          {uploadState.error && (
            <p className="text-xs text-red-400 flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" /> {uploadState.error}
            </p>
          )}

          {/* Controls */}
          <div className="flex items-center gap-3 pt-2">
            {uploadState.status === 'uploading' && (
              <button
                onClick={() => controlsRef.current?.pause()}
                className="flex items-center gap-1.5 rounded-lg bg-amber-600/20 border border-amber-500/30 px-4 py-2 text-xs font-medium text-amber-300 hover:bg-amber-600/30 transition-colors"
              >
                <Pause className="h-3.5 w-3.5" /> Pause
              </button>
            )}

            {uploadState.status === 'paused' && (
              <button
                onClick={() => controlsRef.current?.resume()}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 transition-colors shadow-[0_0_15px_rgba(37,99,235,0.4)]"
              >
                <Play className="h-3.5 w-3.5" /> Resume
              </button>
            )}

            {(uploadState.status === 'uploading' || uploadState.status === 'paused' || uploadState.status === 'error') && (
              <button
                onClick={() => controlsRef.current?.abort()}
                className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
            )}

            {uploadState.status === 'completed' && (
              <div className="flex items-center justify-between w-full">
                <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                  <CheckCircle className="h-4 w-4" /> Upload completed successfully!
                </span>
                <button
                  onClick={() => controlsRef.current?.abort()}
                  className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
                >
                  Upload Another
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}