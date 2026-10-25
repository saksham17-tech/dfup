'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowser, hasPublicSupabaseConfig } from '@/lib/supabaseBrowser';
import Wordmark from '@/components/Wordmark';
import ChunkStrip, { buildCells } from '@/components/ChunkStrip';
import { btnPrimary, btnSecondary, inputClass } from '@/lib/ui';

const PANEL_CELLS = buildCells(
  40,
  Array.from({ length: 27 }, (_, i) => i),
);

export default function LoginPage() {
  const router = useRouter();
  const configured = hasPublicSupabaseConfig();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const supabase = getSupabaseBrowser();
      if (mode === 'signup') {
        const { error: signErr } = await supabase.auth.signUp({ email, password });
        if (signErr) throw signErr;
        setInfo('Check your inbox to confirm your email, or sign in if confirmations are off.');
      } else {
        const { error: signErr } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signErr) throw signErr;
        router.replace('/dashboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  async function signInGoogle() {
    setError(null);
    setBusy(true);
    try {
      const supabase = getSupabaseBrowser();
      const { error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
        },
      });
      if (oauthErr) throw oauthErr;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed');
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen md:grid-cols-[5fr_6fr]">
      <aside className="hidden flex-col justify-between bg-ink p-10 text-paper md:flex">
        <Wordmark />
        <div>
          <p className="max-w-sm font-display text-4xl font-semibold leading-tight tracking-tight">
            Large files, uploaded in pieces you can pause.
          </p>
          <div className="mt-8 max-w-sm">
            <ChunkStrip tone="dark" tall cells={PANEL_CELLS} />
          </div>
        </div>
        <p className="text-sm text-paper/60">4 MB pieces, checked on arrival.</p>
      </aside>

      <main className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <Wordmark className="mb-10 md:hidden" />
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {mode === 'signin' ? 'Sign in to Vault' : 'Create your account'}
          </h1>

          {!configured && (
            <p
              role="alert"
              className="mt-5 rounded-md border border-alert/30 bg-alert-soft px-3 py-2 text-sm text-alert"
            >
              Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to
              .env.local, then restart the dev server.
            </p>
          )}

          <button
            type="button"
            onClick={signInGoogle}
            disabled={busy || !configured}
            className={`${btnSecondary} mt-7 w-full`}
          >
            Continue with Google
          </button>

          <div className="my-6 flex items-center gap-3 text-sm text-muted">
            <span className="h-px flex-1 bg-line" />
            or use email
            <span className="h-px flex-1 bg-line" />
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block text-sm font-medium">
              Email
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium">
              Password
              <input
                type="password"
                required
                minLength={6}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-alert">
                {error}
              </p>
            )}
            {info && (
              <p role="status" className="text-sm text-cobalt">
                {info}
              </p>
            )}
            <button
              type="submit"
              disabled={busy || !configured}
              className={`${btnPrimary} w-full`}
            >
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <button
            type="button"
            className="mt-5 text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setError(null);
              setInfo(null);
            }}
          >
            {mode === 'signin'
              ? 'New here? Create an account'
              : 'Already have an account? Sign in'}
          </button>
        </div>
      </main>
    </div>
  );
}
