// Reusable content envelope — the fields every stored PF2e content entity shares.
//
// This is the base the roadmap calls for: spells are the first entity, but feats,
// items, and the rest will `...contentBaseSchema.shape` the same envelope so that
// "official vs homebrew" and "id + pinned version" are modeled once, not per type.
//
// Two architectural invariants live here (root CLAUDE.md, "Working conventions"):
//   • Characters reference content by id AND a pinned version — never embed, never
//     reference live. So every entity carries both `id` and an integer `version`.
//   • Official and homebrew share ONE schema, differing only by `ownerKind`.
//
// PURE: schema + types only, no I/O. Validation happens at the edge (packages/db)
// by parsing rows through these schemas.

import { z } from 'zod';

/** PF2e rarity tiers. Stored as its own field though it reads as a trait on AoN. */
export const RARITIES = ['common', 'uncommon', 'rare', 'unique'] as const;
export const raritySchema = z.enum(RARITIES);
export type Rarity = z.infer<typeof raritySchema>;

/** Who authored the entity. The ONLY structural difference official/homebrew. */
export const ownerKindSchema = z.enum(['official', 'homebrew']);
export type OwnerKind = z.infer<typeof ownerKindSchema>;

/** Attribution — kept on every entity so the Community Use / ORC notices stay honest. */
export const sourceSchema = z.object({
  title: z.string().min(1),
  page: z.number().int().positive().optional(),
});
export type Source = z.infer<typeof sourceSchema>;

/**
 * The shared envelope. Spread its `.shape` into each entity schema rather than
 * relying on `.extend`, so the base stays a plain object schema.
 */
export const contentBaseSchema = z.object({
  /** Stable slug identity (e.g. "fireball"). Characters pin id + version. */
  id: z.string().min(1),
  /** Monotonic content version; bumped on an explicit content edit, never silently. */
  version: z.number().int().nonnegative(),
  name: z.string().min(1),
  ownerKind: ownerKindSchema,
  source: sourceSchema,
  rarity: raritySchema,
  /** Verbatim as imported — legacy traits (schools, "Negative") are NOT rewritten. */
  traits: z.array(z.string()),
  /** Pre-Remaster content, flagged (not normalized) so the raw traits stay trustworthy. */
  isLegacy: z.boolean(),
});
export type ContentBase = z.infer<typeof contentBaseSchema>;

/** The six PF2e ability scores, by short key. Shared by ancestries/backgrounds/classes. */
export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export const abilitySchema = z.enum(ABILITIES);
export type Ability = z.infer<typeof abilitySchema>;

/**
 * A single ability-boost slot: a fixed ability, `'free'` (player picks any), or a
 * restricted choice among the listed abilities (array of 2+). Shared by ancestries
 * and backgrounds.
 */
export const boostSchema = z.union([
  abilitySchema,
  z.literal('free'),
  z.array(abilitySchema).min(2),
]);
export type Boost = z.infer<typeof boostSchema>;

/**
 * Slugify a name into a stable id: lowercase, punctuation → underscores.
 * Mirrors the bot's existing `toSlug` so ids line up across the two importers.
 */
export function slugify(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
