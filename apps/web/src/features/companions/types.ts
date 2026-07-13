import type { CompanionAbilityMods, CompanionForm, CompanionKind } from '@pathway/core';

export type { CompanionForm, CompanionKind };

/**
 * Per-field stat overrides layered over a companion's auto-scaled stats. The KEY
 * NAMES here are the bot's (apps/bot/src/commands/companion/helpers.js:351-388),
 * NOT @pathway/core's — the bot reads these verbatim, so they must match exactly
 * (`fort`/`ref`/`will`, `attackBonus`, `damageDice`, `damageBonus`). Any field
 * left undefined keeps the automatic scaling.
 */
export interface CompanionOverrides {
  hp?: number;
  ac?: number;
  attackBonus?: number;
  damageDice?: string;
  damageBonus?: number;
  speed?: string;
  size?: string;
  perception?: number;
  abilities?: Partial<Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>>;
  saves?: Partial<Record<'fort' | 'ref' | 'will', number>>;
}

/** A hand-entered extra ability (bot key: custom_stats.customAbilities). */
export interface CompanionCustomAbility {
  name: string;
  description: string;
  actionCost?: string;
}

/** A hand-entered extra attack (bot key: custom_stats.customAttacks). */
export interface CompanionCustomAttack {
  name: string;
  bonus: number;
  damage: string;
  damageType?: string;
  traits?: string[];
}

/** Freeform stat block for a custom companion (all fields optional). */
export interface CustomCompanionStats {
  size?: string;
  hp?: number;
  ac?: number;
  perception?: number;
  speed?: string;
  senses?: string[];
  abilityMods?: Partial<CompanionAbilityMods>;
  attacks?: Array<{
    name: string;
    attack?: number;
    damage?: string;
    damageType?: string;
    traits?: string[];
  }>;
  saves?: { fortitude?: number; reflex?: number; will?: number };
}

/**
 * The `companions.custom_stats` JSONB envelope. The bot reads/writes the keys it
 * knows (apps/bot/src/state/companions.js); the website adds `kind` and the
 * per-kind payloads below. Both sides must preserve keys they don't manage, or
 * the other drops them on its next sync — so writes are read-modify-write.
 */
export interface CompanionCustomStats {
  /** Which kind of companion this row is (the website's discriminator). */
  kind?: CompanionKind;
  /** Bestiary/PDF-derived base block for custom companions (bot). */
  customStats?: unknown;
  art?: string | null;
  skills?: Record<string, number>;
  customAbilities?: CompanionCustomAbility[];
  customAttacks?: CompanionCustomAttack[];
  overrides?: CompanionOverrides;
  /** Familiar: the abilities channelled into it (slugs into FAMILIAR_ABILITIES). */
  familiar?: { abilities: string[] };
  /**
   * Eidolon: subtype slug (into EIDOLON_TYPES), which of its builds (ability
   * array) was chosen, and the player-chosen primary unarmed attack.
   */
  eidolon?: { type: string; build?: number; primaryName?: string; primaryDie?: string };
  /** Custom companion: a hand-entered stat block. */
  custom?: CustomCompanionStats;
}

/** A row of the `companions` table (the bot's canonical companion store). */
export interface CompanionRow {
  user_id: string;
  char_key: string;
  comp_key: string;
  display_name: string;
  /** Catalog slug (e.g. "wolf") for animal/mount; else "familiar"/"eidolon"/"custom". */
  base_type: string;
  form: CompanionForm;
  notes: string | null;
  current_hp: number | null;
  is_active: boolean;
  custom_stats: CompanionCustomStats;
  updated_at?: string;
}

/** Read a row's kind, inferring 'animal' for legacy rows without an explicit kind. */
export function companionKind(row: Pick<CompanionRow, 'base_type' | 'custom_stats'>): CompanionKind {
  return row.custom_stats?.kind ?? 'animal';
}
