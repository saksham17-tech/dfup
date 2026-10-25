export default function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2.5 font-display text-xl font-semibold tracking-tight ${className}`}
    >
      <svg width="22" height="18" viewBox="0 0 22 18" aria-hidden="true">
        <rect x="0" y="2" width="4" height="16" rx="1" fill="currentColor" />
        <rect x="6" y="2" width="4" height="16" rx="1" fill="currentColor" />
        <rect x="12" y="2" width="4" height="16" rx="1" fill="currentColor" />
        <rect
          x="18.5"
          y="2.5"
          width="3"
          height="15"
          rx="1"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.5"
        />
      </svg>
      Vault
    </span>
  );
}
