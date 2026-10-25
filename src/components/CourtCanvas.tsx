'use client';

import { useEffect, useRef } from 'react';
import { mountCourt } from '@/lib/court/scene';
import { warnCourtFailure } from '@/lib/court/fallback';
import type { UploadBridge } from '@/lib/court/uploadBridge';

// ── Imperative renderer, isolated from the upload card and its React state ──
export default function CourtCanvas({
  bridge,
  onReady,
  onFailure,
}: {
  bridge: UploadBridge;
  onReady: () => void;
  onFailure: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    let dispose: (() => void) | undefined;
    const failed = (error: unknown) => {
      warnCourtFailure(error);
      onFailure();
    };
    try {
      const query = new URLSearchParams(window.location.search);
      if (query.get('webgl') === '0' || query.get('courtError') === '1')
        throw new Error(
          'Court initialization disabled for fallback verification',
        );
      const seed = query.has('seed')
        ? Number(query.get('seed'))
        : Date.now() % 2147483647;
      dispose = mountCourt(host.current, bridge, {
        seed: Number.isFinite(seed) ? seed : 123,
        perf: query.get('perf') === '1',
        onFailure: failed,
      });
      onReady();
    } catch (error) {
      failed(error);
    }
    return () => dispose?.();
  }, [bridge, onReady, onFailure]);
  return <div ref={host} className="court-webgl" />;
}
