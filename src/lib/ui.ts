/** Shared button styles so every action looks and behaves the same. */
const base =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none';

export const btnPrimary = `${base} bg-ink text-paper hover:bg-ink/85`;
export const btnAccent = `${base} bg-cobalt text-white hover:bg-cobalt/90`;
export const btnSecondary = `${base} border border-line bg-surface text-ink hover:bg-paper`;
export const btnDanger = `${base} bg-alert-soft text-alert hover:bg-alert/15`;
export const btnSmall = 'min-h-9 px-3';

export const inputClass =
  'mt-1.5 h-11 w-full rounded-md border border-line bg-surface px-3 text-ink placeholder:text-muted/70 focus:border-cobalt';

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}
