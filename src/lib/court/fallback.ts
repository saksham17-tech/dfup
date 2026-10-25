// ── One warning per page, regardless of how the renderer fails ──
let warned = false;
export function warnCourtFailure(error: unknown) {
  if (warned) return;
  warned = true;
  console.warn(
    `Court unavailable; upload controls remain available. ${error instanceof Error ? error.message : String(error)}`,
  );
}
