/** A pitch seen from above: touchlines, halfway line and a filled centre spot. */
export default function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="5" width="22" height="18" rx="2" />
      <path d="M14 5v18" />
      <circle cx="14" cy="14" r="3.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
