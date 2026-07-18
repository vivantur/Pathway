/**
 * The sheet's condition tracker — a VIEW over `@pathway/core`'s condition vocabulary.
 *
 * This file used to hold its own 31-entry table. That was the third condition table in
 * the repo (core's, the bot's, and this one), and it had drifted: its Blinded summary
 * claimed the condition makes you off-guard, which the rules do not say. Core's table
 * is built from rules text and is now the one definition; this module only adapts it to
 * how the sheet stores and displays conditions.
 *
 * TWO ADAPTATIONS, both deliberate:
 *  • STORAGE IS NAME-KEYED. Characters store `ActiveCondition { name, value? }` in the
 *    `overlay.web_edits.conditions` slot, and the bot writes conditions of its own. So
 *    nothing here changes the stored shape — names bridge to core slugs by lower-casing,
 *    which is exact for all 41. Migrating the storage would risk both existing
 *    characters and the bot sync for no gain.
 *  • DYING AND WOUNDED ARE HIDDEN from the picker. They have dedicated bot-synced
 *    steppers on the sheet, and core marks them `death-track` (owned by the bot's combat
 *    model) — so offering them here would be a second way to set the same thing.
 */
import {
  CONDITIONS,
  CONDITION_SLUGS,
  isConditionSlug,
  type ConditionDef as CoreConditionDef,
  type ConditionSlug,
  type HeldCondition,
} from '@pathway/core';
import type { ActiveCondition } from '@/features/characters/types';

/** What the tracker UI needs about a condition. A projection of core's definition. */
export interface ConditionDef {
  name: string;
  valued: boolean;
  summary: string;
}

const project = (d: CoreConditionDef): ConditionDef => ({
  name: d.name,
  valued: d.valued,
  summary: d.summary,
});

/**
 * Conditions offerable in the tracker. Excludes the death track (own steppers) and the
 * five attitudes plus Broken, which describe an NPC's disposition or an object rather
 * than anything that belongs on a player's condition list.
 */
const HIDDEN: ReadonlySet<ConditionSlug> = new Set<ConditionSlug>([
  'dying', 'wounded', 'doomed',
  'friendly', 'helpful', 'hostile', 'indifferent', 'unfriendly',
  'broken',
]);

export const PF2E_CONDITIONS: ConditionDef[] = CONDITION_SLUGS.filter((s) => !HIDDEN.has(s))
  .map((s) => project(CONDITIONS[s]))
  .sort((a, b) => a.name.localeCompare(b.name));

/** A stored condition NAME ("Off-Guard") to core's slug ("off-guard"). */
export function conditionSlug(name: string): ConditionSlug | undefined {
  const slug = name.trim().toLowerCase().replace(/\s+/g, '-');
  return isConditionSlug(slug) ? slug : undefined;
}

export function conditionDef(name: string): ConditionDef | undefined {
  const slug = conditionSlug(name);
  return slug ? project(CONDITIONS[slug]) : undefined;
}

/** Is this a valued condition? Unknown names are treated as boolean. */
export function isValuedCondition(name: string): boolean {
  return conditionDef(name)?.valued ?? false;
}

/**
 * The sheet's stored conditions as core's `HeldCondition[]`, ready for
 * `conditionModifiers`/`conditionGaps`.
 *
 * Reads BOTH sources the sheet displays: the web-owned tracker list and the bot-managed
 * dying/wounded columns. A condition the bot applied has to move the numbers too, or the
 * sheet would show a Frightened character with unchanged stats. Names core does not
 * recognize are dropped rather than guessed — a free-text status is not a condition.
 */
export function heldConditions(
  web: readonly ActiveCondition[] | undefined,
  columns?: { dying?: number | null; wounded?: number | null },
): HeldCondition[] {
  const out: HeldCondition[] = [];
  for (const c of web ?? []) {
    const slug = conditionSlug(c.name);
    if (!slug) continue;
    out.push(c.value != null ? { slug, value: c.value } : { slug });
  }
  if ((columns?.dying ?? 0) > 0) out.push({ slug: 'dying', value: columns!.dying! });
  if ((columns?.wounded ?? 0) > 0) out.push({ slug: 'wounded', value: columns!.wounded! });
  return out;
}
