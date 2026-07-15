// @pathway/core — the single source of truth for the PF2e domain.
//
// This package is PURE: no I/O, no database, no network, no Discord. It holds
// the content schema (Zod), the character model, and the derived-stat engine.
// The bot (apps/bot) and the web app (apps/web) both consume it so they can
// never disagree on a rules value. See root CLAUDE.md, "Architecture".
//
// TODO (kickstart Prompts 1–2): content schemas + derived-stat engine, each
// implemented from pasted rules text and locked by tests against human-verified
// worked examples. Nothing rules-shaped should be computed outside this package.

export const CORE_PLACEHOLDER = true as const;

// PF2e class proficiency progression (the first real slice of the derived-stat
// engine to live in core). Consumed by apps/web's character builder.
export * from './proficiency.js';

// Scalar stat primitives: ability modifiers, the proficiency-bonus formula
// (incl. Proficiency Without Level), and rank encoding conversions. Consumed
// by both of apps/web's engines (builder + sheet).
export * from './stats.js';

// Animal companion catalog + derived-stat engine. Consumed by apps/web's
// companion builder.
export * from './companion.js';

// Derived-stat compositions (HP, saves, Perception, skills, DCs, AC). The single
// implementation both of apps/web's engines (builder + sheet) adapt onto.
export * from './derived.js';

// Canonical stat-selector vocabulary — the read-surface namespace (`ac`,
// `fortitude`, a skill slug, …) the effects engine resolves targets against, and
// the shared list of the 16 skill slugs. A shared primitive of both layers.
export * from './selectors.js';

// The expression language — the bounded, sandboxed evaluator for effect values
// (AST + `evaluate`/`parseExpr` + the `ExprScope` seam). One implementation for
// both the Foundry-ingest value path and the effect engine. No `eval`.
export * from './expr.js';

// The counter — a general spend/restore resource primitive (focus points, item
// charges, "recharge 6" pools, …). Spellcasting resources are a specialized
// layer over these same verbs, added later. Pure mechanics, no rules.
export * from './counter.js';

// Degree of success — the shared resolver attack/save/check route through
// (four degrees, natural-20/1 shift, ability adjustments). A core L2 primitive,
// implemented from rules text and locked by the worked examples in its tests.
export * from './degree.js';

// The damage-type vocabulary — physical/energy types + materials + categories +
// the structured `DamageDescriptor`. A shared L2 primitive; vocabulary only, no
// resistance/bypass resolution (that is rules behavior, implemented later).
export * from './damage.js';

// The resolved-character model — the effects engine's PUBLIC INPUT SURFACE.
// `ResolvedCharacter` + `resolveSelector`/`characterNamespace`: the shape both
// the web builder and the Pathbuilder reader emit, and what the expression
// language reads. Pure and input-only (no rules math). See character.ts.
export * from './character.js';

// Effects engine: resolves the machine-readable rule elements on chosen feats
// into concrete sheet adjustments (HP bonuses, proficiency-rank grants).
export * from './effects.js';

// Content envelope shared by every stored PF2e entity (id + pinned version,
// official/homebrew, rarity, source). The template the content schemas extend.
export * from './content.js';

// The spell entity: the canonical `spellSchema`/`Spell` shape plus `coerceSpell`,
// the adapter that ingests messy DB/import rows into it. First content slice;
// replaces the duplicated spell readers in apps/web and apps/bot.
export * from './spell.js';

// Ancestry + heritage entities (second content slice). Heritages are standalone
// (own `ancestryId`; empty = versatile). Consolidates the web builder's
// Ancestry/Heritage interfaces and adds senses + special abilities.
export * from './ancestry.js';

// Background entity (third content slice). Restricted-choice + free boosts;
// optional trained skill / lore / skill feat.
export * from './background.js';

// Feat entity (fourth content slice). Display/lookup scope; `rules` carried as
// dormant effect feedstock for the future effect engine (never interpreted here).
export * from './feat.js';
