'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { UploadCloud, Folder, Trash2, LogOut, Menu, X } from 'lucide-react';
import Wordmark from './Wordmark';

const NAV = [
  {
    href: '/dashboard?view=upload',
    view: 'upload',
    label: 'Upload',
    icon: UploadCloud,
  },
  {
    href: '/dashboard?view=files',
    view: 'files',
    label: 'My files',
    icon: Folder,
  },
  { href: '/dashboard?view=bin', view: 'bin', label: 'Bin', icon: Trash2 },
] as const;

// ── Dashboard presentation; authentication remains in the route layout ──
export default function DashboardFrame({ children, view, email, logout }: {
  children: ReactNode; view: string; email: string | null; logout: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="min-h-screen md:flex">
        {/* Mobile top bar */}
        <header className="court-glass flex h-14 items-center justify-between border-b border-line bg-surface/80 px-4 md:hidden">
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
          data-court-avoid
          className={`court-rail court-glass fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-surface/80 p-2 motion-reduce:transition-none md:visible md:translate-x-0 ${
            open ? 'visible translate-x-0' : 'invisible -translate-x-full'
          }`}
        >
          <div className="mb-8 flex items-center justify-between px-2 pt-1">
            <Link href="/" aria-label="Vault home" title="Vault home" className="rail-brand">
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
                  aria-label={item.label}
                  title={item.label}
                  className={`flex min-h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors motion-reduce:transition-none ${
                    active
                      ? 'bg-cobalt-soft font-medium text-cobalt'
                      : 'text-muted hover:bg-paper hover:text-ink'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="rail-label" aria-hidden="true">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-line pt-3">
            <p className="rail-label truncate px-3 text-sm text-muted" title={email ?? ''}>
              {email}
            </p>
            <button
              type="button"
              onClick={logout}
              aria-label="Sign out"
              title="Sign out"
              className="mt-1 flex min-h-10 w-full items-center gap-3 rounded-md px-3 text-sm text-muted transition-colors hover:bg-alert-soft hover:text-alert motion-reduce:transition-none"
            >
              <LogOut className="h-4 w-4" />
              <span className="rail-label" aria-hidden="true">Sign out</span>
            </button>
          </div>
        </aside>

        <main className="dashboard-main min-w-0 flex-1 px-5 py-8 sm:px-10 sm:py-12">
          {children}
        </main>
      </div>
    </>
  );
}
