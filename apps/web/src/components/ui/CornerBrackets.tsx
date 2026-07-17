/**
 * Decorative gilded corner brackets for framed "hero" panels — the small
 * L-shaped marks in each corner that give the Vault header its illuminated,
 * character-sheet feel. Render inside a `relative` container.
 *
 * Defaults reproduce the original fixed 16px/1px marks. The landing hero
 * overrides them for the larger 26px/2px gilded frame.
 */
export function CornerBrackets({
  /** Arm length of each bracket, in px. */
  size = 16,
  /** Border weight, in px. */
  thickness = 1,
  /** Distance from the container's edge, in px. Negative overhangs. */
  inset = 6,
  /** Border color — any CSS color, e.g. a `var(--…)` token. */
  color = 'rgb(var(--c-gold) / 0.6)',
}: {
  size?: number;
  thickness?: number;
  inset?: number;
  color?: string;
} = {}) {
  const arm = { width: size, height: size, borderColor: color };
  const w = `${thickness}px`;

  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute"
        style={{ ...arm, left: inset, top: inset, borderLeftWidth: w, borderTopWidth: w }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute"
        style={{ ...arm, right: inset, top: inset, borderRightWidth: w, borderTopWidth: w }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute"
        style={{ ...arm, left: inset, bottom: inset, borderLeftWidth: w, borderBottomWidth: w }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute"
        style={{ ...arm, right: inset, bottom: inset, borderRightWidth: w, borderBottomWidth: w }}
      />
    </>
  );
}
