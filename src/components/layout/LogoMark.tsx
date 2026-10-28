export function LogoMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="18" fill="rgb(var(--surface-2))" />
      <path
        d="M9 32c6-10 13.5-15.5 23-15.5S49 22 55 32c-6 10-13.5 15.5-23 15.5S15 42 9 32z"
        fill="none"
        stroke="rgb(var(--primary))"
        strokeWidth="4.5"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="32" r="8.5" fill="rgb(var(--accent))" />
    </svg>
  );
}
