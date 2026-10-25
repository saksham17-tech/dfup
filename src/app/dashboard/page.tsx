import { Suspense } from 'react';
import DashboardClient from '@/components/DashboardClient';

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-sm text-muted">Loading your files…</div>
      }
    >
      <DashboardClient />
    </Suspense>
  );
}
