/** A gold filigree divider — a decorative rule with a center arcane node. */
export function GildedRule({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex items-center justify-center gap-3 ${className}`}
      aria-hidden
    >
      <span className="h-px flex-1 bg-gilded-rule" />
      <span className="h-1.5 w-1.5 rotate-45 bg-gold shadow-arcane" />
      <span className="h-px flex-1 bg-gilded-rule" />
    </div>
  );
}
