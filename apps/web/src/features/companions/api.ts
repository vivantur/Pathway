import { requireSupabase } from '@/lib/supabase';
import type {
  CompanionCustomAbility,
  CompanionCustomAttack,
  CompanionCustomStats,
  CompanionForm,
  CompanionKind,
  CompanionOverrides,
  CompanionRow,
  CustomCompanionStats,
} from './types';

const COLUMNS =
  'user_id, char_key, comp_key, display_name, base_type, form, notes, current_hp, is_active, custom_stats, updated_at';

/** Lowercase companion slug, unique per character (matches the bot's comp_key). */
export function slugifyCompKey(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'companion'
  );
}

/** All companions for one character, keyed by the logical (user_id, char_key). */
export async function listCompanions(userId: string, charKey: string): Promise<CompanionRow[]> {
  const { data, error } = await requireSupabase()
    .from('companions')
    .select(COLUMNS)
    .eq('user_id', userId)
    .eq('char_key', charKey)
    .order('display_name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CompanionRow[];
}

async function fetchExisting(
  userId: string,
  charKey: string,
  compKey: string,
): Promise<CompanionRow | null> {
  const { data, error } = await requireSupabase()
    .from('companions')
    .select(COLUMNS)
    .eq('user_id', userId)
    .eq('char_key', charKey)
    .eq('comp_key', compKey)
    .maybeSingle();
  if (error) throw error;
  return (data as CompanionRow | null) ?? null;
}

export interface SaveCompanionInput {
  userId: string;
  charKey: string;
  /** Set when editing an existing companion; otherwise a comp_key is derived. */
  compKey?: string;
  kind: CompanionKind;
  displayName: string;
  /** Catalog slug (e.g. "wolf") for animal/mount; else "familiar"/"eidolon"/"custom". */
  baseType: string;
  form: CompanionForm;
  notes?: string | null;
  art?: string | null;
  /** Familiar: ability slugs. */
  familiarAbilities?: string[];
  /** Eidolon: subtype slug. */
  eidolonType?: string;
  /** Eidolon extras: chosen build (ability array) + primary unarmed attack. */
  eidolonBuild?: number;
  eidolonPrimaryName?: string;
  eidolonPrimaryDie?: string;
  /** Custom companion: a hand-entered stat block. */
  custom?: CustomCompanionStats;
  /**
   * Per-field stat overrides (bot key names), layered over auto-scaled stats and
   * read verbatim by the bot. Pass the COMPLETE desired set when provided —
   * omitted fields clear that override (back to auto-scale).
   */
  overrides?: CompanionOverrides;
  /** Extra skills the bot displays (skill name → total modifier). */
  skills?: Record<string, number>;
  /** Hand-entered extra abilities the bot displays. */
  customAbilities?: CompanionCustomAbility[];
  /** Hand-entered extra attacks the bot displays. */
  customAttacks?: CompanionCustomAttack[];
}

/** Drop undefined/empty entries so we never persist blank override keys. */
function pruneOverrides(o: CompanionOverrides | undefined): CompanionOverrides | undefined {
  if (!o) return undefined;
  const out: CompanionOverrides = {};
  if (o.hp != null) out.hp = o.hp;
  if (o.ac != null) out.ac = o.ac;
  if (o.attackBonus != null) out.attackBonus = o.attackBonus;
  if (o.damageDice) out.damageDice = o.damageDice;
  if (o.damageBonus != null) out.damageBonus = o.damageBonus;
  if (o.speed) out.speed = o.speed;
  if (o.size) out.size = o.size;
  if (o.perception != null) out.perception = o.perception;
  const abilities = Object.fromEntries(
    Object.entries(o.abilities ?? {}).filter(([, v]) => v != null),
  );
  if (Object.keys(abilities).length) out.abilities = abilities;
  const saves = Object.fromEntries(Object.entries(o.saves ?? {}).filter(([, v]) => v != null));
  if (Object.keys(saves).length) out.saves = saves;
  return out;
}

/**
 * Create or update a companion. On edit we READ-MODIFY-WRITE the `custom_stats`
 * envelope so any nested keys the bot manages (skills, overrides, custom
 * attacks/abilities) are preserved — writing a fresh envelope would drop them
 * on the bot's next Realtime patch.
 */
export async function saveCompanion(input: SaveCompanionInput): Promise<CompanionRow> {
  const supabase = requireSupabase();
  const compKey = input.compKey ?? slugifyCompKey(input.displayName);
  const existing = input.compKey
    ? await fetchExisting(input.userId, input.charKey, compKey)
    : null;

  // Read-modify-write: preserve any keys the bot manages, set the ones we own.
  const customStats: CompanionCustomStats = {
    ...(existing?.custom_stats ?? {}),
    kind: input.kind,
    art: input.art ?? existing?.custom_stats?.art ?? null,
  };
  if (input.kind === 'familiar') customStats.familiar = { abilities: input.familiarAbilities ?? [] };
  if (input.kind === 'eidolon')
    customStats.eidolon = {
      type: input.eidolonType ?? '',
      build: input.eidolonBuild ?? 0,
      primaryName: input.eidolonPrimaryName,
      primaryDie: input.eidolonPrimaryDie,
    };
  if (input.kind === 'custom') customStats.custom = input.custom ?? existing?.custom_stats?.custom ?? {};

  // Stat overrides + extras (bot-read keys). When the caller manages these
  // (edit form), it passes the complete desired set — so we REPLACE rather than
  // merge, letting a cleared field fall back to auto-scaling. When omitted, we
  // preserve whatever the bot last wrote (already spread in above).
  if (input.overrides !== undefined) {
    const pruned = pruneOverrides(input.overrides);
    if (pruned && Object.keys(pruned).length) customStats.overrides = pruned;
    else delete customStats.overrides;
  }
  if (input.skills !== undefined) {
    if (Object.keys(input.skills).length) customStats.skills = input.skills;
    else delete customStats.skills;
  }
  if (input.customAbilities !== undefined) {
    if (input.customAbilities.length) customStats.customAbilities = input.customAbilities;
    else delete customStats.customAbilities;
  }
  if (input.customAttacks !== undefined) {
    if (input.customAttacks.length) customStats.customAttacks = input.customAttacks;
    else delete customStats.customAttacks;
  }

  const row = {
    user_id: input.userId,
    char_key: input.charKey,
    comp_key: compKey,
    display_name: input.displayName,
    base_type: input.baseType,
    form: input.form,
    // `notes` is NOT NULL in the live table (defaults to ''), so never send null.
    notes: input.notes ?? existing?.notes ?? '',
    custom_stats: customStats,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('companions')
    .upsert(row, { onConflict: 'user_id,char_key,comp_key' })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data as CompanionRow;
}

export async function deleteCompanion(
  userId: string,
  charKey: string,
  compKey: string,
): Promise<void> {
  const { error } = await requireSupabase()
    .from('companions')
    .delete()
    .eq('user_id', userId)
    .eq('char_key', charKey)
    .eq('comp_key', compKey);
  if (error) throw error;
}

/**
 * Make one companion the character's active companion (and clear the others),
 * mirroring the bot's single-`activeCompanion` invariant per character.
 */
export async function setActiveCompanion(
  userId: string,
  charKey: string,
  compKey: string,
): Promise<void> {
  const supabase = requireSupabase();
  const stamp = new Date().toISOString();
  // Clear all, then set the chosen one — two scoped writes under the user's RLS.
  const clear = await supabase
    .from('companions')
    .update({ is_active: false, updated_at: stamp })
    .eq('user_id', userId)
    .eq('char_key', charKey)
    .neq('comp_key', compKey);
  if (clear.error) throw clear.error;
  const set = await supabase
    .from('companions')
    .update({ is_active: true, updated_at: stamp })
    .eq('user_id', userId)
    .eq('char_key', charKey)
    .eq('comp_key', compKey);
  if (set.error) throw set.error;
}
