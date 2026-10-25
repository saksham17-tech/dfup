'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { UploadCloud, Folder, Trash2, LogOut, Menu, X } from 'lucide-react';
import { getSupabaseBrowser, hasPublicSupabaseConfig } from '@/lib/supabaseBrowser';
import Wordmark from '@/components/Wordmark';

const NAV = [
  { href: '/dashboard?view=upload', view: 'upload', label: 'Upload', icon: UploadCloud },
  { href: '/dashboard?view=files', view: 'files', label: 'My files', icon: Folder },
  { href: '/dashboard?view=bin', view: 'bin', label: 'Bin', icon: Trash2 },
] as const;

function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get('view');
  const view =
    raw === 'files' || raw === 'bin' || raw === 'upload' ? raw : 'upload';

  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false); // mobile drawer

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
    <div className="min-h-screen md:flex">
      {/* Mobile top bar */}
      <header className="flex h-14 items-center justify-between border-b border-line bg-surface px-4 md:hidden">
        <Link href="/" aria-label="Vault home">
          <Wordmark className="text-lg" />
        </Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="grid h-10 w-10 place-items-center rounded-md text-ink hover:bg-paper"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {open && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-ink/40 md:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-surface p-4 transition-transform motion-reduce:transition-none md:sticky md:top-0 md:h-screen md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-8 flex items-center justify-between px-2 pt-1">
          <Link href="/" aria-label="Vault home">
            <Wordmark />
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="grid h-9 w-9 place-items-center rounded-md text-muted hover:bg-paper hover:text-ink md:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav aria-label="Main" className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => {
            const active = view === item.view;
            const Icon = item.icon;
            return (
              <Link
                key={item.view}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors motion-reduce:transition-none ${
                  active
                    ? 'bg-cobalt-soft font-medium text-cobalt'
                    : 'text-muted hover:bg-paper hover:text-ink'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-line pt-3">
          <p className="truncate px-3 text-sm text-muted" title={email ?? ''}>
            {email}
          </p>
          <button
            type="button"
            onClick={logout}
            className="mt-1 flex min-h-10 w-full items-center gap-3 rounded-md px-3 text-sm text-muted transition-colors hover:bg-alert-soft hover:text-alert motion-reduce:transition-none"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-5 py-8 sm:px-10 sm:py-12">
        {children}
      </main>
    </div>
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
