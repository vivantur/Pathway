// Toggles — the player-controlled switches that assert tags.
//
// A `Predicate` asks "is `spellshape:reach-spell` active?". Something has to make it
// active. For the overwhelming majority of the corpus that something is THE PLAYER: a
// checkbox on the sheet ("am I using Reach Spell?"), not derived combat state.
//
// WHY THIS IS NOT A PassiveEffect. Everything in `passive.ts` answers "what number on
// the sheet does this change". A toggle changes no number — it changes which tags are
// active, and the effects that follow are whatever OTHER elements predicate on those
// tags. So it lives in its own `toggles` field on the mapping result, exactly as
// `grants` does for build-graph edges (see grants.ts for the same argument).
//
// MEASURED over the corpus's 546 `RollOption` elements (2026-07-20). Three distinct
// mechanisms hide under that one Foundry key, and only the first is modelled here:
//   • 473 (87%)  PLAYER TOGGLE      — `toggleable`. This module.
//   • ~45        CONSTANT TAG       — `alwaysActive`, or bare with no gate. Also here,
//                                     as `alwaysOn`: a declaration whose tag needs no
//                                     switch.
//   • ~52        DERIVED TAG        — a NON-toggleable predicated RollOption, i.e. a tag
//                                     asserted BECAUSE OF other tags. Disarming Flair
//                                     gives your Disarm the `bravado` trait, which
//                                     Derring-Do then reads. DEFERRED: a tag that
//                                     depends on tags needs evaluation ordering that
//                                     `predicate.ts`'s single-pass set membership does
//                                     not have, and it is its own slice.
//
// LIFETIME IS NOT MOMENTARY COMBAT STATE, which is the thing this measurement corrected.
// A toggle persists until the player flips it — it is stored character state, the same
// kind of thing as `overlay.web_edits.conditions`. Nothing here needs a combat tracker.
//
// PURE: schemas, a set union, and a lookup. No PF2e rules.

import { z } from "zod";
import { predicateHolds, predicateSchema } from "./predicate.js";

/**
 * One selectable variant of a toggle — Deflecting Wave's acid/bludgeoning/fire/slashing.
 *
 * `label` is OPTIONAL and usually absent, deliberately. See `toggleDeclarationSchema`.
 */
export const toggleVariantSchema = z
  .object({
    /** The value appended to the option: `deflecting-wave` + `acid`. */
    value: z.string().min(1),
    /** Human-readable name. Absent when the source had none we could use. */
    label: z.string().min(1).optional(),
    /** When this VARIANT is offered at all — Crystal Healing's +3 needs more training. */
    when: predicateSchema.optional(),
  })
  .strict();
export type ToggleVariant = z.infer<typeof toggleVariantSchema>;

/**
 * A switch an entity offers, and the tag(s) flipping it asserts.
 *
 * ON LABELS. `label` is absent far more often than not, and that is a deliberate
 * refusal rather than a gap: 460 of the corpus's 593 labels are Foundry LOCALIZATION
 * KEYS (`PF2E.TraitAcid`, `PF2E.SpecificRule.BonusLabel.PlusOne`), not text. Shipping
 * those would put literal `PF2E.TraitAcid` on a character sheet. Only the 133 that are
 * already human text are kept; for the rest the UI humanizes `value`, which is a real
 * word (`acid`) and cannot render as gibberish.
 */
export const toggleDeclarationSchema = z
  .object({
    /** The tag base this asserts, e.g. `spellshape` or `deflecting-wave`. */
    option: z.string().min(1),
    /** Human-readable name; absent when the source offered only an i18n key. */
    label: z.string().min(1).optional(),
    /** The choices, when the toggle is a picker rather than a checkbox. */
    variants: z.array(toggleVariantSchema).min(1).optional(),
    /**
     * Active without the player doing anything (Foundry's `alwaysActive`). Still a
     * declaration rather than a bare tag, because such an option can STILL carry
     * variants — "always on, but pick which skill".
     */
    alwaysOn: z.boolean().optional(),
    /** When the toggle is available at all — Crystal Healing needs Occultism training. */
    when: predicateSchema.optional(),
  })
  .strict();
export type ToggleDeclaration = z.infer<typeof toggleDeclarationSchema>;

/**
 * The player's switch positions, keyed by `option`.
 *
 * `true` flips a plain toggle on; a string selects that variant. `false`/absent is off.
 * This is what persists on the character (`overlay.web_edits.toggles`) — a small,
 * additive JSONB key, not a schema change.
 */
export const toggleStateSchema = z.record(z.string(), z.union([z.boolean(), z.string()]));
export type ToggleState = z.infer<typeof toggleStateSchema>;

/**
 * The tags a set of declarations asserts, given the player's switch positions.
 *
 * EMITS BOTH the base and the variant-qualified tag, because the corpus consumes both:
 * Crystal Healing's own effect predicates on bare `crystal-healing` while Deflecting
 * Wave's predicate on `deflecting-wave:acid`. Emitting only one form would silently
 * fail to fire half of them.
 *
 * AVAILABILITY IS NOT EVALUATED HERE. A declaration's `when` says whether the switch
 * should be OFFERED, which depends on the character and belongs to whoever renders the
 * control; this function answers only "given these positions, which tags are active".
 * Splitting them keeps this a pure set union with no `ResolvedCharacter` dependency.
 *
 * An unrecognized variant value contributes nothing rather than throwing — stored state
 * outlives content, and a feat that drops an option should not break a sheet.
 */
export function toggleTags(
  declarations: readonly ToggleDeclaration[] | undefined,
  state: ToggleState | undefined,
): string[] {
  if (!declarations?.length) return [];
  const tags = new Set<string>();

  for (const decl of declarations) {
    const position = state?.[decl.option];
    const on = decl.alwaysOn === true || position === true || typeof position === "string";
    if (!on) continue;

    tags.add(decl.option);

    if (typeof position === "string" && decl.variants?.some((v) => v.value === position)) {
      tags.add(`${decl.option}:${position}`);
    }
  }

  return [...tags];
}

/** Whether a toggle should be OFFERED at all, given the active tag set. */
export function toggleAvailable(decl: ToggleDeclaration, tags: ReadonlySet<string>): boolean {
  return predicateHolds(decl.when, tags);
}

/**
 * The tags a set of toggle declarations CAN produce — base plus every variant form,
 * regardless of switch position.
 *
 * This is the corpus-wide vocabulary a consumer's predicate is checked against: a feat
 * that reads `spellshape:reach-spell` is only mappable because some declaration can
 * assert that tag. Collected from the DECLARATIONS the mapper already produced rather
 * than re-parsing Foundry, so the producer and consumer sides cannot disagree about
 * what a valid option tag is.
 */
export function producedOptionTags(declarations: readonly ToggleDeclaration[]): Set<string> {
  const tags = new Set<string>();
  for (const decl of declarations) {
    tags.add(decl.option);
    for (const v of decl.variants ?? []) tags.add(`${decl.option}:${v.value}`);
  }
  return tags;
}

/**
 * The variants of a toggle that are actually offered, given the active tag set.
 *
 * The rendering half of the split described on `toggleTags`. Takes the tag set rather
 * than a character so it stays free of `character.ts` — the caller already builds one
 * for predicate evaluation.
 */
export function availableVariants(decl: ToggleDeclaration, tags: ReadonlySet<string>): ToggleVariant[] {
  if (!decl.variants) return [];
  return decl.variants.filter((v) => predicateHolds(v.when, tags));
}
