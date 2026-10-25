'use client';

import { useEffect, useRef, useState } from 'react';
import ChunkStrip, { buildCells } from './ChunkStrip';
import { createCourtScene, type CourtScene } from '@/lib/courtScene';
import { clamp } from '@/lib/courtMath';

export type CourtProgressProps = {
  totalPieces: number;
  savedIndices: number[];
  inFlightCount?: number;
  phase: 'idle' | 'uploading' | 'paused' | 'finishing' | 'completed' | 'error';
  label: string;
  progress: number;
  variant?: 'full' | 'compact';
};

const phaseText = {
  idle: 'Ready to upload', uploading: 'Uploading', paused: 'Paused',
  finishing: 'Putting the file together…', completed: 'Complete', error: 'Upload stopped',
};

export default function CourtProgress(props: CourtProgressProps) {
  // A static fallback also covers SSR, hydration, and unavailable Canvas 2D.
  const [reduced, setReduced] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<CourtScene | null>(null);
  const latest = useRef(props);
  useEffect(() => { latest.current = props; });

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(media.matches);
    change();
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    if (reduced || unavailable || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const scene = createCourtScene(canvas, latest.current);
    if (!scene) {
      setUnavailable(true);
      return;
    }
    sceneRef.current = scene;
    let intersecting = false;
    const visibility = () => scene.setVisible(intersecting && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      visibility();
    });
    observer.observe(canvas);
    const resize = new ResizeObserver(() => scene.resize());
    resize.observe(canvas);
    window.addEventListener('resize', scene.resize);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener('resize', scene.resize);
      document.removeEventListener('visibilitychange', visibility);
      scene.destroy();
      sceneRef.current = null;
    };
  }, [reduced, unavailable]);

  useEffect(() => { sceneRef.current?.update(props); }, [props]);

  const fallback = reduced || unavailable;
  const active = props.phase === 'uploading' ? props.inFlightCount ?? 0 : 0;
  return (
    <div className="relative">
      <div className={`court-frame ${props.variant === 'compact' ? 'court-compact' : ''}`}>
        {fallback ? (
          <div className="flex h-full flex-col justify-center gap-4 px-4 sm:px-8">
            <ChunkStrip
              cells={buildCells(props.totalPieces, props.savedIndices, active)}
              tall label={props.label} valueNow={clamp(props.progress, 0, 100)}
            />
          </div>
        ) : (
          <canvas ref={canvasRef} className="block h-full w-full"
            role="progressbar" aria-label={props.label} aria-valuemin={0}
            aria-valuemax={100} aria-valuenow={clamp(props.progress, 0, 100)} />
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-4 top-3 flex items-center justify-between gap-3 text-xs font-medium text-muted sm:inset-x-6 sm:top-4">
        <span className="rounded border border-line bg-surface px-2 py-1">{phaseText[props.phase]}</span>
        {props.totalPieces > 64 && (
          <span className="rounded bg-surface px-2 py-1 tabular-nums">
            1 ball ≈ {Math.ceil(props.totalPieces / 64)} pieces
          </span>
        )}
      </div>
    </div>
  );
}
