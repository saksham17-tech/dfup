export type ChunkCell = { fill: number; active?: boolean };

/**
 * Collapse N upload chunks into at most `maxCells` segments.
 * Each segment fills in proportion to how many of its chunks are saved.
 * The first `activeCount` unsaved chunks are marked as in flight.
 */
export function buildCells(
  totalChunks: number,
  completed: Iterable<number>,
  activeCount = 0,
  maxCells = 64,
): ChunkCell[] {
  const done = new Set<number>(completed);
  const total = Math.max(1, totalChunks);
  const n = Math.min(total, maxCells);

  const activeIdx = new Set<number>();
  for (let i = 0; i < total && activeIdx.size < activeCount; i++) {
    if (!done.has(i)) activeIdx.add(i);
  }

  const cells: ChunkCell[] = [];
  for (let k = 0; k < n; k++) {
    const from = Math.floor((k * total) / n);
    const to = Math.floor(((k + 1) * total) / n);
    const size = Math.max(1, to - from);
    let saved = 0;
    let active = false;
    for (let i = from; i < to; i++) {
      if (done.has(i)) saved++;
      if (activeIdx.has(i)) active = true;
    }
    cells.push({ fill: saved / size, active });
  }
  return cells;
}

type Props = {
  cells: ChunkCell[];
  tone?: 'light' | 'dark';
  tall?: boolean;
  /** Pass for a real progress readout; omit for decorative strips. */
  label?: string;
  valueNow?: number;
};

export default function ChunkStrip({
  cells,
  tone = 'light',
  tall = false,
  label,
  valueNow,
}: Props) {
  const height = tall ? 'h-14 sm:h-16' : 'h-9';
  const a11y =
    label !== undefined && valueNow !== undefined
      ? {
          role: 'progressbar' as const,
          'aria-label': label,
          'aria-valuemin': 0,
          'aria-valuemax': 100,
          'aria-valuenow': Math.round(valueNow),
        }
      : { 'aria-hidden': true as const };

  return (
    <div
      {...a11y}
      className="grid gap-[3px]"
      style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}
    >
      {cells.map((c, i) => (
        <span
          key={i}
          className={`chunk-cell ${height} ${tone === 'dark' ? 'chunk-cell-dark' : ''} ${
            c.active ? 'chunk-active' : ''
          }`}
        >
          <span
            className="chunk-fill"
            style={{ height: `${Math.round(c.fill * 100)}%` }}
          />
        </span>
      ))}
    </div>
  );
}
