// ── rules/strikeAdapter.js ──────────────────────────────────────────────────
//
// The bot's adapter from a stored character's WEAPON to a core Strike and the
// Layer-2 automation tree that runs it — the piece that lets a player Strike
// through the effects engine (`/strike`), the way `/use` runs an authored action.
//
// It is an ADAPTER in the `pf2eMath.js` mould, and the root CLAUDE.md's one rule
// governs it: NO rules arithmetic lives here. Every number — the attack roll, MAP,
// crit doubling, deadly/fatal dice — comes out of `@pathway/core`'s `resolveStrike`
// + `strikeAutomation`. This module only decodes the bot's stored weapon shape and
// its conventions into core's inputs, and chooses the overrides.
//
// THE ONE DECISION THAT SHAPES IT: we TRUST the character's stored, precomputed
// attack + damage-bonus totals rather than re-deriving proficiency rank. Bot
// characters are overwhelmingly Pathbuilder imports, whose weapons carry a
// pre-summed to-hit (`attack`) and flat damage (`damageBonus`); native builds
// store the same normalized totals via `getCharacterWeapons`. This is exactly the
// deliberate "trust the imported build" path the web app runs for Pathbuilder
// characters (root CLAUDE.md, "Point web at core"), and it keeps the bot out of
// the class/group/feat rank orchestration it has no tables for. Core still owns
// the STRUCTURE: dice, damage type, deadly/fatal crit dice, and MAP all come from
// the source's traits + die, fed through `resolveStrike`.
//
// PURE, in the sense `rules/` means it: no I/O, no Supabase, no discord.js. It is
// a function over the plain weapon bag `getCharacterWeapons` returns.

'use strict';

const core = require('@pathway/core');

// ── convention decoding (the adapter's whole job) ────────────────────────────

/**
 * Normalize a display trait string to core's canonical token. Core matches
 * simple traits by exact lowercase (`agile`, `finesse`, `propulsive`) and the
 * variant-bearing ones by a hyphenated grammar (`two-hand-d10`, `versatile-p`,
 * `deadly-d10`). Lowercasing and collapsing whitespace to a single hyphen turns
 * every source's spelling — Pathbuilder's, a custom attack's, AoN's "Deadly d10"
 * — into that shape. `traitDieSize` is already whitespace/​hyphen tolerant, so
 * this is belt-and-braces for it and load-bearing for the strict variant regexes.
 */
function normalizeTrait(t) {
  return String(t ?? '').trim().toLowerCase().replace(/\s+/g, '-');
}

/** `"d8"` / `"1d8"` / `"2d6"` / `8` → the die SIZE (8). Null if unreadable. */
function parseDieSize(die) {
  if (typeof die === 'number' && Number.isInteger(die) && die > 0) return die;
  const m = /d(\d+)/i.exec(String(die ?? ''));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Pathbuilder stores damage as a single letter; custom attacks store the word.
const DAMAGE_LETTERS = { s: 'slashing', p: 'piercing', b: 'bludgeoning' };

/**
 * Decode a stored damage type into a core `DamageType`, or null if it is not one
 * we can stand behind. Accepts the single-letter codes Pathbuilder uses and the
 * full words a custom attack carries; anything else is reported, never guessed —
 * a damage type the engine cannot reason about is worse than a named gap.
 */
function normalizeDamageType(type) {
  const raw = String(type ?? '').trim().toLowerCase();
  if (!raw) return null;
  const word = raw.length === 1 ? DAMAGE_LETTERS[raw] : raw;
  return word && core.isDamageType(word) ? word : null;
}

// Striking runes set the damage DICE COUNT (1 + rank). Pathbuilder stores them as
// named strings in `runes`; the rank is what core's `runes.striking` wants.
const STRIKING_RANKS = [
  { re: /major\s*striking/i, rank: 3 },
  { re: /greater\s*striking/i, rank: 2 },
  { re: /\bstriking\b/i, rank: 1 },
];

/** The striking-rune rank (0–3) implied by a weapon's stored runes. */
function strikingRank(entry) {
  const runes = Array.isArray(entry?.runes) ? entry.runes.map(String) : [];
  const text = runes.join(' ');
  for (const { re, rank } of STRIKING_RANKS) {
    if (re.test(text)) return rank;
  }
  return 0;
}

/** A stable, selector-safe id from a weapon's name (`"Longsword +1"` → `longsword-1`). */
function slug(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'weapon';
}

// ── the adapter ──────────────────────────────────────────────────────────────

/**
 * Build a core `Strike` and its automation tree from a stored weapon entry.
 *
 * `entry` is one item from `state/characters.getCharacterWeapons(charEntry)`:
 * a Pathbuilder weapon (`{ name, die, attack, damageBonus, damageType, runes }`),
 * a normalized custom attack (which additionally carries `traits`), or a
 * bot-added attack. `actor` is `{ level, mods }` — a `ResolvedCharacter` satisfies
 * it (build one with `core.resolvedFromPathbuilder(charEntry.data)`).
 *
 * `opts.traits` overrides the entry's own traits when a caller has a better source
 * (e.g. a reference-item lookup for a Pathbuilder weapon, which stores none).
 *
 * Returns `{ strike, nodes, source, warnings, agile }` on success, or
 * `{ error }` when the weapon's damage cannot be read — in which case NO strike is
 * offered rather than a guessed one, the same contract the ingest mapper keeps.
 *
 * `warnings` is the honesty surface: a Pathbuilder weapon carries no traits, so its
 * strike cannot know it is agile (MAP −4 vs −5) or deadly/fatal (extra crit dice).
 * Those are named, not silently approximated — a wrong crit is worse than an
 * absent one.
 */
function buildStrike(entry, actor, opts = {}) {
  const warnings = [];
  const name = String(entry?.display || entry?.name || '').trim() || 'Strike';

  const dieSize = parseDieSize(entry?.die);
  if (dieSize === null) return { error: `unreadable damage die ${JSON.stringify(entry?.die)}` };

  const damageType = normalizeDamageType(entry?.damageType);
  if (!damageType) return { error: `unknown damage type ${JSON.stringify(entry?.damageType)}` };

  const rawTraits = Array.isArray(opts.traits) ? opts.traits
    : Array.isArray(entry?.traits) ? entry.traits
      : [];
  const traits = rawTraits.map(normalizeTrait).filter(Boolean);
  if (traits.length === 0) {
    warnings.push(
      'No weapon traits available for this strike, so MAP is assumed −5 and any ' +
      'agile / deadly / fatal effect is not applied. (Pathbuilder does not export ' +
      'weapon traits.)',
    );
  }

  // Variants (two-hand, versatile, fatal-aim, thrown) are core's to parse — the
  // adapter must not grow a second reading of the trait grammar.
  const { variants } = core.parseStrikeVariants(traits);
  const hasVariants = Object.keys(variants).length > 0;

  // Ranged is cosmetic here — both totals are overridden below, so the trait-
  // derived ability/range selection changes no number — but declaring it keeps the
  // descriptor honest for the display and for any future scoped effect.
  const range = traits.includes('ranged') ? 'ranged' : 'melee';

  const source = {
    id: slug(name),
    name,
    kind: 'strike',
    range,
    weapon: slug(name),
    traits,
    damageDie: dieSize,
    damageType,
    ...(hasVariants ? { variants } : {}),
  };

  // TRUST the stored totals. `attackTotal` / `damageTotal` replace core's computed
  // attack modifier and flat damage bonus outright; `rank` then feeds nothing, so 0
  // is a placeholder, not a claim. The DICE (base + striking + deadly/fatal) still
  // come from the source, which is what keeps crit and striking correct.
  const attackTotal = Number.isFinite(Number(entry?.attack)) ? Number(entry.attack) : 0;
  const damageTotal = Number.isFinite(Number(entry?.damageBonus)) ? Number(entry.damageBonus) : 0;

  const strike = core.resolveStrike(actor, {
    source,
    rank: 0,
    runes: { striking: strikingRank(entry) },
    overrides: { attackTotal, damageTotal },
  });

  const agile = traits.includes('agile');
  const nodes = core.strikeAutomation(strike, { agile });

  return { strike, nodes, source, warnings, agile };
}

module.exports = {
  buildStrike,
  // exported for tests + reuse by the command's autocomplete/lookup
  normalizeTrait,
  parseDieSize,
  normalizeDamageType,
  strikingRank,
  slug,
};
