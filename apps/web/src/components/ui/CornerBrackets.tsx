/**
 * Decorative gilded corner brackets for framed "hero" panels — the small
 * L-shaped marks in each corner that give the Vault header its illuminated,
 * character-sheet feel. Render inside a `relative` container.
 */
export function CornerBrackets() {
  const cls = 'pointer-events-none absolute h-4 w-4 border-gold/60';
  return (
    <>
      <span className={`${cls} left-1.5 top-1.5 border-l border-t`} aria-hidden />
      <span className={`${cls} right-1.5 top-1.5 border-r border-t`} aria-hidden />
      <span className={`${cls} bottom-1.5 left-1.5 border-b border-l`} aria-hidden />
      <span className={`${cls} bottom-1.5 right-1.5 border-b border-r`} aria-hidden />
    </>
  );
}
