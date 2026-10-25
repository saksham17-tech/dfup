'use client';

import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import CourtProgress from './CourtProgress';
import { btnSecondary, btnSmall } from '@/lib/ui';

const TOTAL = 48;
const PAUSE_AT = 26;

type Phase = 'uploading' | 'paused' | 'finishing' | 'done';

/** A looping demonstration of pause and resume: the one moving part on the landing page. */
export default function HeroDemo() {
  const [saved, setSaved] = useState(0);
  const [phase, setPhase] = useState<Phase>('uploading');
  const [run, setRun] = useState(0);
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(media.matches);
    change();
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    if (reduced) {
      setSaved(PAUSE_AT);
      setPhase('paused');
      return;
    }

    let n = 0;
    let resumed = false;
    let timer: ReturnType<typeof setTimeout>;
    setSaved(0);
    setPhase('uploading');

    const step = () => {
      if (n >= TOTAL) {
        setPhase('finishing');
        timer = setTimeout(() => {
          setPhase('done');
          timer = setTimeout(() => setRun((r) => r + 1), 4800);
        }, 1000);
        return;
      }
      if (n === PAUSE_AT && !resumed) {
        setPhase('paused');
        timer = setTimeout(() => {
          resumed = true;
          setPhase('uploading');
          step();
        }, 2400);
        return;
      }
      n += 1;
      setSaved(n);
      timer = setTimeout(step, 120);
    };
    timer = setTimeout(step, 600);

    return () => clearTimeout(timer);
  }, [run, reduced]);

  const savedIndices = Array.from({ length: saved }, (_, i) => i);

  const message =
    phase === 'paused'
      ? 'Paused. Resume sends only the pieces that are still missing.'
      : phase === 'done'
        ? 'Complete. Every piece is saved.'
        : phase === 'finishing'
          ? 'All pieces arrived. Putting the file together on the server…'
        : 'Uploading';

  return (
    <div className="rounded-lg border border-line bg-surface p-5 sm:p-8">
      <div className="flex items-baseline justify-between gap-4">
        <p className="truncate font-display text-lg font-semibold">
          site-footage-final.mov
        </p>
        <p className="shrink-0 text-sm tabular-nums text-muted">192 MB</p>
      </div>

      <div className="mt-5">
        <CourtProgress totalPieces={TOTAL} savedIndices={savedIndices}
          inFlightCount={phase === 'uploading' ? Math.min(3, TOTAL - saved) : 0}
          phase={phase === 'done' ? 'completed' : phase}
          label="Demo upload progress" progress={saved / TOTAL * 100} variant="full" />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          <span aria-live="polite">{message}</span>{' '}
          <span className="tabular-nums">
            {saved} of {TOTAL} pieces saved.
          </span>
        </p>
        {!reduced && phase === 'done' && (
          <button
            type="button"
            onClick={() => setRun((r) => r + 1)}
            className={`${btnSecondary} ${btnSmall}`}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Replay
          </button>
        )}
      </div>
    </div>
  );
}
