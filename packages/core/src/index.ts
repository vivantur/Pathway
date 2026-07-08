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
export * from './proficiency';

// Scalar stat primitives: ability modifiers, the proficiency-bonus formula
// (incl. Proficiency Without Level), and rank encoding conversions. Consumed
// by both of apps/web's engines (builder + sheet).
export * from './stats';

// Animal companion catalog + derived-stat engine. Consumed by apps/web's
// companion builder.
export * from './companion';
