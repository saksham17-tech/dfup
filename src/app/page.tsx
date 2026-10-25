import Link from 'next/link';
import Wordmark from '@/components/Wordmark';
import HeroDemo from '@/components/HeroDemo';
import { btnPrimary, btnSecondary } from '@/lib/ui';

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center px-5 py-5 sm:px-8">
        <Wordmark />
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-24 sm:px-8">
        <section className="pt-10 sm:pt-20">
          <h1 className="max-w-3xl font-display text-5xl font-semibold leading-[1.02] tracking-tight sm:text-7xl">
            Pause an upload. Pick it back up where it stopped.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
            Vault sends large files in 4 MB pieces and keeps track of each
            one. If you pause or a request fails, only the missing pieces go
            up again.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/login" className={btnPrimary}>
              Sign in
            </Link>
            <Link
              href="https://github.com/xsanchitgupta/distributed_file_upload_system"
              target="_blank"
              rel="noopener noreferrer"
              className={btnSecondary}
            >
              View source
            </Link>
          </div>
        </section>

        <section className="mt-14 sm:mt-20" aria-label="Pause and resume demo">
          <HeroDemo />
        </section>

        <dl className="mt-16 grid gap-10 sm:grid-cols-3">
          <div>
            <dt className="font-display text-xl font-semibold">Checked on arrival</dt>
            <dd className="mt-2 max-w-xs text-muted">
              Each piece carries a SHA-256 checksum. The server rejects any
              piece that doesn&rsquo;t match.
            </dd>
          </div>
          <div>
            <dt className="font-display text-xl font-semibold">Resume without re-sending</dt>
            <dd className="mt-2 max-w-xs text-muted">
              After a pause, Vault asks the server which pieces it already
              holds and uploads the rest.
            </dd>
          </div>
          <div>
            <dt className="font-display text-xl font-semibold">Deleted files can come back</dt>
            <dd className="mt-2 max-w-xs text-muted">
              Deleting moves a file to the bin first. Restore it, or remove
              it for good.
            </dd>
          </div>
        </dl>
      </main>
    </div>
  );
}
