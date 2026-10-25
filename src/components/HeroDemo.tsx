'use client';

import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import ChunkStrip, { type ChunkCell } from './ChunkStrip';
import { btnSecondary, btnSmall } from '@/lib/ui';

const TOTAL = 48;
const PAUSE_AT = 26;

type Phase = 'uploading' | 'paused' | 'done';

/** A looping demonstration of pause and resume: the one moving part on the landing page. */
export default function HeroDemo() {
  const [saved, setSaved] = useState(0);
  const [phase, setPhase] = useState<Phase>('uploading');
  const [run, setRun] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const prefersReduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    setReduced(prefersReduced);

    if (prefersReduced) {
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
        setPhase('done');
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
  }, [run]);

  const cells: ChunkCell[] = Array.from({ length: TOTAL }, (_, i) => ({
    fill: i < saved ? 1 : 0,
    active: phase === 'uploading' && i >= saved && i < saved + 3,
  }));

  const message =
    phase === 'paused'
      ? 'Paused. Resume sends only the pieces that are still missing.'
      : phase === 'done'
        ? 'Complete. Every piece is saved.'
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
        <ChunkStrip cells={cells} tall />
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
