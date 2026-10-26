'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import RecentFiles from './RecentFiles';
import { uploadBridge } from '@/lib/court/uploadBridge';
import FileUploader from './FileUploader';
import FileDashboard from './FileDashboard';

export default function DashboardClient() {
  const searchParams = useSearchParams();
  const rawView = searchParams.get('view');
  const view = rawView === 'files' || rawView === 'bin' ? rawView : 'upload';

  const [refreshSignal, setRefreshSignal] = useState(0);
  useEffect(() => { uploadBridge.setView(view === 'upload' ? 'upload' : 'browse'); }, [view]);

  const handleUploadSuccess = useCallback(() => {
    setRefreshSignal((prev) => prev + 1);
  }, []);

  return (
    <div className="mx-auto max-w-4xl">
      {view === 'upload' && (
        <div>
          <h1 className="sr-only">Upload</h1>
          <FileUploader onSuccess={handleUploadSuccess} />
          <RecentFiles refreshSignal={refreshSignal} />
        </div>
      )}

      {view === 'files' && (
        <div>
          <h1 className="file-view-heading mb-4 font-display text-4xl font-semibold tracking-tight">
            My files
          </h1>
          <FileDashboard refreshSignal={refreshSignal} />
        </div>
      )}

      {view === 'bin' && (
        <div>
          <div className="file-view-heading mb-4"><h1 className="font-display text-4xl font-semibold tracking-tight">
            Bin
          </h1>
          <p className="mt-2 max-w-prose text-muted">
            Files in the bin are deleted automatically after 5 days. Restore
            one before then, or delete it permanently now.
          </p></div>
          <FileDashboard isBin refreshSignal={refreshSignal} />
        </div>
      )}
    </div>
  );
}
