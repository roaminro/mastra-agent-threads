export function Logo() {
  return (
    <div className="flex items-center gap-2 text-sm font-medium tracking-tight">
      <svg viewBox="0 0 16 16" className="size-4 text-signal" aria-hidden>
        <circle cx="4" cy="4" r="2" fill="currentColor" />
        <circle cx="12" cy="8" r="2" fill="currentColor" />
        <circle cx="4" cy="12" r="2" fill="currentColor" />
        <path d="M4 6v4M6 4h2a2 2 0 0 1 2 2v0M6 12h2a2 2 0 0 0 2-2v0" stroke="currentColor" strokeWidth="1.2" fill="none" />
      </svg>
      agent threads
    </div>
  );
}
