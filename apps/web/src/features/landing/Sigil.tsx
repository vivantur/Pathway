/**
 * The Pathway compass-star mark — the favicon geometry redrawn inline so it
 * takes `var()` colors and follows the theme (the .svg file can't).
 *
 * - `full` — orbit rings + arcane center bead. The nav mark.
 * - `outer` — star inside a single gold ring. The vault-door quote.
 * - `bare` — just the star. The footer wordmark.
 */
export function Sigil({
  size = 34,
  variant = 'full',
  className = '',
}: {
  size?: number;
  variant?: 'full' | 'outer' | 'bare';
  className?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      {variant !== 'bare' && (
        <circle
          cx="32"
          cy="32"
          r="24"
          fill="none"
          stroke="rgb(var(--c-gold))"
          strokeWidth="1.3"
          opacity="0.65"
        />
      )}
      {variant === 'full' && (
        <circle
          cx="32"
          cy="32"
          r="17"
          fill="none"
          stroke="rgb(var(--c-arcane))"
          strokeWidth="1"
          opacity="0.5"
        />
      )}
      <path
        d="M32 8 L36.5 27.5 L56 32 L36.5 36.5 L32 56 L27.5 36.5 L8 32 L27.5 27.5 Z"
        fill="rgb(var(--c-gold))"
      />
      {variant === 'full' && (
        <circle cx="32" cy="32" r="3" fill="#0b1026" stroke="rgb(var(--c-arcane))" strokeWidth="1" />
      )}
    </svg>
  );
}
