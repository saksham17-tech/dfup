'use client';

import dynamic from 'next/dynamic';
import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { UploadBridge } from '@/lib/court/uploadBridge';
import { warnCourtFailure } from '@/lib/court/fallback';

// ── Lazy boundary: Three.js never enters the login or critical landing bundle ──
const CourtCanvas = dynamic(() => import('./CourtCanvas'), {
  ssr: false,
  loading: () => null,
});
const CourtContext = createContext(false);
export const useCourtAvailable = () => useContext(CourtContext);

class SceneBoundary extends Component<
  { children: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    warnCourtFailure(error);
    this.props.onFailure();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// ── Live reduced-motion preference shared by scene and progress fallback ──
export function useReducedCourtMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => setReduced(query.matches);
    changed();
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);
  return reduced;
}

export default function CourtEnvironment({
  bridge,
  children,
}: {
  bridge: UploadBridge;
  children: ReactNode;
}) {
  const reduced = useReducedCourtMotion();
  const [failed, setFailed] = useState(false),
    [ready, setReady] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const failedScene = useCallback(() => {
    setFailed(true);
    setReady(false);
  }, []);
  const readyScene = useCallback(() => setReady(true), []);
  return (
    <CourtContext.Provider value={!reduced && ready && !failed}>
      <div className="court-environment">
        {mounted &&
          createPortal(
            <>
              <div className="court-backdrop" aria-hidden="true">
                {!reduced && !failed && (
                  <SceneBoundary onFailure={failedScene}>
                    <CourtCanvas
                      bridge={bridge}
                      onReady={readyScene}
                      onFailure={failedScene}
                    />
                  </SceneBoundary>
                )}
              </div>
              <div className="court-scrim" aria-hidden="true" />
            </>,
            document.body,
          )}
        <div className="court-content">{children}</div>
      </div>
    </CourtContext.Provider>
  );
}
