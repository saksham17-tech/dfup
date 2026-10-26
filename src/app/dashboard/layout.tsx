'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  getSupabaseBrowser,
  hasPublicSupabaseConfig,
} from '@/lib/supabaseBrowser';
import DashboardFrame from '@/components/DashboardFrame';
import CourtEnvironment from '@/components/CourtEnvironment';
import { uploadBridge } from '@/lib/court/uploadBridge';


function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get('view');
  const view =
    raw === 'files' || raw === 'bin' || raw === 'upload' ? raw : 'upload';

  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Canonicalize /dashboard → /dashboard?view=upload
  useEffect(() => {
    if (!raw || !['upload', 'files', 'bin'].includes(raw)) {
      router.replace('/dashboard?view=upload');
    }
  }, [raw, router]);

  useEffect(() => {
    if (!hasPublicSupabaseConfig()) {
      router.replace('/login');
      return;
    }

    const supabase = getSupabaseBrowser();
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (!data.session) {
        router.replace('/login');
        return;
      }
      setEmail(data.session.user.email ?? 'Signed in');
      setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace('/login');
        return;
      }
      setEmail(session.user.email ?? 'Signed in');
      setReady(true);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  async function logout() {
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut();
    router.replace('/login');
  }

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted">
        Checking your session…
      </div>
    );
  }

  return (
    <CourtEnvironment bridge={uploadBridge}>
      <DashboardFrame view={view} email={email} logout={logout}>{children}</DashboardFrame>
    </CourtEnvironment>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-screen place-items-center text-sm text-muted">
          Loading…
        </div>
      }
    >
      <Shell>{children}</Shell>
    </Suspense>
  );
}
