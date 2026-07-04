import type { CompanionForm } from './engine';

export type { CompanionForm };

/**
 * The `companions.custom_stats` JSONB envelope, exactly as the bot reads/writes
 * it (apps/bot/src/state/companions.js). The website must preserve every nested
 * key it doesn't manage, or the bot drops them on its next Realtime patch.
 */
export interface CompanionCustomStats {
  /** Bestiary/PDF-derived base block for custom companions (null for catalog). */
  customStats?: unknown;
  art?: string | null;
  skills?: Record<string, number>;
  customAbilities?: Array<{ name: string; description: string; actionCost?: string }>;
  customAttacks?: Array<{
    name: string;
    bonus: number;
    damage: string;
    damageType?: string;
    traits?: string[];
  }>;
  overrides?: Record<string, unknown>;
}

/** A row of the `companions` table (the bot's canonical companion store). */
export interface CompanionRow {
  user_id: string;
  char_key: string;
  comp_key: string;
  display_name: string;
  /** Catalog slug (e.g. "wolf") or "custom". */
  base_type: string;
  form: CompanionForm;
  notes: string | null;
  current_hp: number | null;
  is_active: boolean;
  custom_stats: CompanionCustomStats;
  updated_at?: string;
}
