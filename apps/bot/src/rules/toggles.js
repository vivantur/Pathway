// ── rules/toggles.js ────────────────────────────────────────────────────────
//
// The bot's read of a character's PLAYER TOGGLES — the stances and modes a player
// flips on the web sheet (Dragon Stance on, Deflecting Wave set to acid). Stored in
// `overlay.web_edits.toggles` as `{ option: true | "variant" }`, the SAME key the web
// writes (see core's toggles.ts and the web's FeatToggles.tsx).
//
// VISIBILITY ONLY, DELIBERATELY. The bot SHOWS which stances are active so /use has
// the context, but it does NOT yet apply them mechanically: `resolvedFromPathbuilder`
// builds the actor from Pathbuilder's own numbers and applies none of our Layer-1
// passives, so a toggle-gated bonus has nowhere to land. Closing that loop is the
// TAGS SEAM noted as future work in docs/effects-engine-design.md — it belongs at
// actor resolution (applyPassiveEffects with a tag set), not here, and is built when
// the bot does its own math against a real consumer. This module is the honest half
// that works today: the player set a stance, and the bot reports it.
//
// PURE: reads a plain overlay object and formats strings. No I/O, no discord.js.
//
// The bot has only the stored STATE (option slug + position), not the web's toggle
// DECLARATIONS (which carry human labels), so it humanizes the slug. "dragon-stance"
// → "Dragon Stance" is good enough for a context line; a wrong label is impossible
// because there is no label to get wrong.

/** Turn a slug into a readable label: `dragon-stance` → `Dragon Stance`. */
function humanize(slug) {
  return String(slug)
    .replace(/[-:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The toggles a character currently has ON, from `overlay.web_edits.toggles`.
 *
 * Returns `[{ option, variant, display }]`, one per active switch, in a stable
 * (sorted) order so the /use embed reads the same way every run. A `true` position is
 * a plain switch; a string is the chosen variant. Anything falsy is off and omitted.
 * Malformed state (not an object) yields an empty list rather than throwing — a bad
 * overlay must never break a command.
 */
function activeToggles(charEntry) {
  const stored = charEntry?.overlay?.web_edits?.toggles;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return [];

  const out = [];
  for (const [option, position] of Object.entries(stored)) {
    if (position === true) {
      out.push({ option, variant: null, display: humanize(option) });
    } else if (typeof position === 'string' && position !== '') {
      out.push({ option, variant: position, display: `${humanize(option)}: ${humanize(position)}` });
    }
    // false / undefined / '' → off, omitted.
  }
  out.sort((a, b) => a.display.localeCompare(b.display));
  return out;
}

module.exports = { activeToggles, humanize };
