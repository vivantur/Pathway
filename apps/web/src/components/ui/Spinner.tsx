/** A small arcane-cyan loading rune. */
export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-silver/80" role="status">
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-arcane/30 border-t-arcane"
      />
      <span className="text-sm">{label}</span>
    </div>
  );
}
