'use client';

import ChunkStrip, { buildCells } from './ChunkStrip';
import { useCourtAvailable } from './CourtEnvironment';
import { clamp } from '@/lib/courtMath';
import type { CourtPhase } from '@/lib/court/uploadBridge';
import type { CSSProperties } from 'react';

export type CourtProgressProps = {
  totalPieces: number;
  savedIndices: number[];
  inFlightCount?: number;
  phase: CourtPhase;
  label: string;
  progress: number;
  variant?: 'full' | 'compact';
};

// ── Real progress remains available even if every scene resource fails ──
export default function CourtProgress(props: CourtProgressProps) {
  const available = useCourtAvailable();
  const progress = clamp(props.progress, 0, 100);
  if (!available)
    return (
      <ChunkStrip
        cells={buildCells(
          props.totalPieces,
          props.savedIndices,
          props.phase === 'uploading' ? (props.inFlightCount ?? 0) : 0,
        )}
        label={props.label}
        valueNow={progress}
      />
    );
  const segments = Math.min(64, Math.max(1, props.totalPieces));
  return (
    <div className="flex h-9 items-center">
      <div
        role="progressbar"
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        className="court-progress-track w-full"
        style={{ '--piece-width': `${100 / segments}%` } as CSSProperties}
      >
        <span
          className="court-progress-fill"
          style={{ width: `${progress}%` }}
        />
        <span className="court-progress-ticks" aria-hidden="true" />
      </div>
    </div>
  );
}
