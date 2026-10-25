'use client';

import { useCallback, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import FileUploader from './FileUploader';
import FileDashboard from './FileDashboard';

export default function DashboardClient() {
  const searchParams = useSearchParams();
  const rawView = searchParams.get('view');
  const view = rawView === 'files' || rawView === 'bin' ? rawView : 'upload';

  const [refreshSignal, setRefreshSignal] = useState(0);

  const handleUploadSuccess = useCallback(() => {
    setRefreshSignal((prev) => prev + 1);
  }, []);

  return (
    <div className="mx-auto max-w-4xl">
      {view === 'upload' && (
        <div className="space-y-14">
          <h1 className="sr-only">Upload</h1>
          <FileUploader onSuccess={handleUploadSuccess} />
          <FileDashboard
            title="Recent files"
            limit={5}
            refreshSignal={refreshSignal}
            footer={
              <Link
                href="/dashboard?view=files"
                className="text-sm font-medium text-cobalt underline-offset-4 hover:underline"
              >
                See all files
              </Link>
            }
          />
        </div>
      )}

      {view === 'files' && (
        <div>
          <h1 className="mb-8 font-display text-4xl font-semibold tracking-tight">
            My files
          </h1>
          <FileDashboard refreshSignal={refreshSignal} />
        </div>
      )}

      {view === 'bin' && (
        <div>
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            Bin
          </h1>
          <p className="mb-8 mt-2 max-w-prose text-muted">
            Files in the bin are deleted automatically after 5 days. Restore
            one before then, or delete it permanently now.
          </p>
          <FileDashboard isBin refreshSignal={refreshSignal} />
        </div>
      )}
    </div>
  );
}
