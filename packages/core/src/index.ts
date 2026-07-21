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

// The action vocabulary — the finite set of action names a predicate may be gated
// on (`action:demoralize`), plus each skill action's skill(s). A TAG NAMESPACE, not
// runtime state: whoever performs an action asserts the tag.
export * from './actions.js';

// Toggles — player-controlled switches that assert tags (`ToggleDeclaration`,
// `toggleTags`, `ToggleState`). The production side of the tag vocabulary, the way
// `predicate.ts` is the consumption side.
export * from './toggles.js';

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

// Passive-effect predicate — the `when?` condition vocabulary (a boolean tree
// over a finite tag set) + its evaluator + static-tag derivation. Layer 1 of the
// effects engine; one evaluator, two contexts (static sheet now, combat later).
export * from './predicate.js';

// Effects engine: resolves the machine-readable rule elements on chosen feats
// into concrete sheet adjustments (HP bonuses, proficiency-rank grants).
export * from './effects.js';

// The PF2e condition vocabulary — the 41 conditions, the passives the numeric ones
// impose, the implication/override graph, and a CLOSED list of what each does that
// we cannot yet express. Most conditions are not modifiers; the gaps are named.
export * from './conditions.js';

// Layer 1 — the canonical passive-effect union (modifier/proficiency/grant/
// rollAdjust/note) + `applyPassiveEffects`, which folds modifiers onto a
// ResolvedCharacter (via stackModifiers) and collects the deferred kinds into
// typed buckets. OUR schema — the homebrew builder emits it, Foundry maps into it.
export * from './passive.js';

// Layer 1.5 — the applied effect: the bridge carrying Layer-1 passives onto a
// creature during play, plus the duration/tick vocabulary (`TurnMoment`) and the
// pure resolvers (`advanceDuration`/`tickFires`/`sustainEffect`) that keep effect
// timing off-by-one-free. Core owns the semantics; the host's tracker owns the clock.
export * from './applied.js';

// Seeded deterministic PRNG (mulberry32) — the only randomness source the Layer-2
// automation interpreter uses, so an invocation is replayable and testable.
export * from './rng.js';

// Dice notation — a parser + seeded evaluator for `2d6 + strengthMod`-style
// expressions (full arithmetic: + - * /, parens, variable terms). The `roll`
// automation node consumes it. Generic dice; no PF2e rules.
export * from './dice.js';

// Check resolution — the shared d20-vs-DC primitive attack/save/check route
// through (`rollCheck` → a degree via degree.ts), plus `dcFromModifier` (the
// pasted "DC = 10 + modifier" rule) and `degreeOrdinal`. A Layer-2 slice-3
// primitive; the resolution nodes consume it.
export * from './checks.js';

// The multiple attack penalty (Player Core p. 402). Pure arithmetic over a
// turn-scoped count of ATTACK-TRAIT checks — not Strikes, and not a cached
// penalty: the current weapon's own agile trait decides the value every time.
// See docs/strikes-and-weapons.md.
export * from './map.js';

// The Strike model — the slot pipeline that resolves a strike SOURCE plus a
// character into an attack modifier and damage. A weapon is one producer of
// strikes, not the definition of one, which is what lets a non-weapon attack
// (a Kineticist blast, a homebrew attack) exist without a special case.
// See docs/strikes-and-weapons.md.
export * from './strike.js';

// Strike riders — composing a keyword fragment (a condition on hit, an extra die,
// a MAP multiplier) onto a base Strike's Layer-2 tree. See docs/strike-riders-design.md.
export * from './rider.js';

// Weapons — the content entity behind a Strike, plus the fundamental runes
// (potency = attack only, striking = dice count). `weaponToStrikeSources` is
// PLURAL on purpose: a dagger offers a melee strike and a thrown one.
export * from './weapon.js';

// The candidate/review model — how a PROPOSED effect becomes a real one.
// Candidates are a work queue, never content: producers → candidates → promote →
// effects. Storage-agnostic (pure functions over values), so moving content into the
// database later replaces the edge and touches none of this.
export * from './candidate.js';

// Gap + conflict RESOLUTION — the editor backend over candidate.ts. The only path
// from a gapped/conflicting candidate to a decision.
export * from './resolution.js';

// ENTITY GRANTS — a feat that gives you another feat. A build-graph edge, NOT a
// PassiveEffect: it changes which content a character has, not a number on the sheet,
// so the builder walks it and the effects engine never sees it.
export * from './grants.js';

// The Foundry ingest boundary — the ONE module allowed to know Foundry's
// rule-element shape, plus `mapFoundryRules` (their encoding → our PassiveEffect[])
// and its per-element report. Runs at ingest, offline; never on the runtime path.
export * from './foundry.js';

// The prose parser — a candidate.ts PRODUCER, sibling to foundry.ts. Reads PF2e rules
// prose and proposes DRAFT effects (never applied content). The primary ingest route;
// Foundry corroborates. Runs at ingest, offline.
export * from './prose.js';

// Spell heightening rules: the cantrip/focus auto-rank (half your level, rounded up)
// and the "+N per increment" count. The host resolves which rank a spell was cast at
// and passes it to the interpreter; these two rules are core's.
export * from './heightening.js';

// Layer 2 — the automation tree interpreter (skeleton slice): the execution model
// (context + outcome = narration log + intended mutations), the uniform error
// policy, and the rules-free nodes (text/variable/branch). Pure; the rest of the
// node vocabulary lands one slice at a time on top of this contract.
export * from './automation.js';

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

// The Pathbuilder 2e boundary: the format description plus the readers that turn a
// stored build into a `ResolvedCharacter`. Pathbuilder JSON is the STORAGE format
// (the bot's `characters.pathbuilder_data`), not just an import format, so this is
// the one reader every consumer shares — and it is what lets a bot character reach
// the effects engine at all.
export * from './pathbuilder.js';
