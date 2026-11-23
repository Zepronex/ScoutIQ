export default function LoadingSpinner({ text, className = '' }: { text?: string; className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-3 py-8 text-ink-soft ${className}`} role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-pitch-turf" aria-hidden="true" />
      <p className="text-sm font-medium">{text ?? 'Loading…'}</p>
    </div>
  );
}
