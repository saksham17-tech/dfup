// ── Upload events: saved indices are the only source of progress ──
export type CourtPhase =
  'idle' | 'uploading' | 'paused' | 'finishing' | 'completed' | 'error';
export type UploadEvent =
  | { type: 'saved'; index: number }
  | { type: 'phase'; phase: CourtPhase }
  | { type: 'reset' };
export type UploadBridge = ReturnType<typeof createUploadBridge>;

export function createUploadBridge(demo = false) {
  const listeners = new Set<(event: UploadEvent) => void>();
  const saved = new Set<number>();
  let phase: CourtPhase = 'idle',
    total = 1,
    session: string | null = null;
  const emit = (event: UploadEvent) => {
    for (const listener of listeners) {
      // An optional visual subscriber must never interrupt the real upload effect.
      try {
        listener(event);
      } catch {
        /* The renderer owns its failure boundary. */
      }
    }
  };
  const snapshot: {
    readonly phase: CourtPhase;
    readonly total: number;
    readonly saved: ReadonlySet<number>;
  } = {
    get phase() {
      return phase;
    },
    get total() {
      return total;
    },
    saved,
  };
  const setPhase = (next: CourtPhase) => {
    if (next !== phase) {
      phase = next;
      emit({ type: 'phase', phase });
    }
  };
  const bridge = {
    demo,
    snapshot: () => snapshot,
    subscribe(listener: (event: UploadEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    chunkSaved(index: number) {
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= total ||
        saved.has(index)
      )
        return;
      saved.add(index);
      emit({ type: 'saved', index });
    },
    paused: () => setPhase('paused'),
    resumed: () => setPhase('uploading'),
    finishing: () => setPhase('finishing'),
    completed: () => setPhase('completed'),
    failed: () => setPhase('error'),
    reset() {
      saved.clear();
      phase = 'idle';
      session = null;
      emit({ type: 'reset' });
    },
    configure(pieces: number) {
      total = Math.max(1, pieces);
    },
    reconcile(
      indices: readonly number[],
      next: CourtPhase,
      pieces: number,
      fileId: string | null = null,
    ) {
      if (next === 'idle') {
        if (phase !== 'idle' || saved.size) bridge.reset();
        return;
      }
      if (fileId !== null && session !== null && session !== fileId)
        bridge.reset();
      // init starts a new selection before the server assigns its ID.
      if (fileId === null && next === 'uploading' && session !== null)
        bridge.reset();
      total = Math.max(1, pieces);
      if (fileId !== null) session = fileId;
      for (const index of indices) bridge.chunkSaved(index);
      setPhase(next);
    },
  };
  return bridge;
}

// ── The dashboard and landing demo never share an emitter ──
export const uploadBridge = createUploadBridge();
