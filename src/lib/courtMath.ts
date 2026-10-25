export type Point = { x: number; y: number };

export const MAX_BALLS = 64;
export const SHOT_DURATION = 980;
export const SHOT_STAGGER = 150;

export function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

/** Optional output lets the animation reuse a point instead of allocating each frame. */
export function arcPosition(
  from: Point, to: Point, t: number, height: number, out: Point = { x: 0, y: 0 },
): Point {
  const u = clamp(t);
  out.x = from.x + (to.x - from.x) * u;
  out.y = from.y + (to.y - from.y) * u - 4 * height * u * (1 - u);
  return out;
}

export function rackSlot(index: number, width: number, height: number): Point {
  const radius = ballRadius(width, height);
  const columns = 8;
  return {
    x: width * 0.065 + radius + (index % columns) * radius * 2.15,
    y: height * 0.85 - Math.floor(index / columns) * radius * 2.05,
  };
}

export function pileSlot(index: number, width: number, height: number): Point {
  const radius = ballRadius(width, height);
  return {
    x: width * 0.72 + radius + (index % 8) * radius * 1.85
      + (Math.floor(index / 8) % 2) * radius * 0.4,
    y: height * 0.85 - Math.floor(index / 8) * radius * 1.65,
  };
}

export function ballRadius(width: number, height: number): number {
  return Math.min(width * 0.012, height * 0.029);
}

export function groupedCount(pieces: number, total: number): number {
  return Math.ceil(clamp(pieces, 0, total) / Math.max(1, Math.ceil(total / MAX_BALLS)));
}

export function validSavedIndices(total: number, indices: readonly number[]): Set<number> {
  return new Set(indices.filter((index) => Number.isInteger(index) && index >= 0 && index < total));
}
