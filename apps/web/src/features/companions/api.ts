import { requireSupabase } from '@/lib/supabase';
import type {
  CompanionCustomStats,
  CompanionForm,
  CompanionKind,
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
  /** Animal/mount: specialization slug (only meaningful on nimble/savage). */
  specialization?: string | null;
  notes?: string | null;
  art?: string | null;
  /** Familiar: ability slugs. */
  familiarAbilities?: string[];
  /** Familiar: abilities choosable per day (base 2). */
  familiarAbilityLimit?: number;
  /** Eidolon: subtype slug. */
  eidolonType?: string;
  /** Eidolon extras: chosen build (ability array) + primary unarmed attack. */
  eidolonBuild?: number;
  eidolonPrimaryName?: string;
  eidolonPrimaryDie?: string;
  /** Custom companion: a hand-entered stat block. */
  custom?: CustomCompanionStats;
}

/**
 * Create or update a companion. On edit we READ-MODIFY-WRITE the `custom_stats`
 * envelope so any nested keys the bot manages (skills, overrides, custom
 * attacks/abilities) are preserved — writing a fresh envelope would drop them
 * on the bot's next Realtime patch.
 *
 * Create (no `compKey`) uses INSERT, never upsert: a new companion whose name
 * slugifies to an existing comp_key must not silently replace that row (and
 * drop the bot-managed stats it carried). On key collision we suffix -2, -3, …
 * until the insert lands — the unique index arbitrates races for us.
 */
export async function saveCompanion(input: SaveCompanionInput): Promise<CompanionRow> {
  const supabase = requireSupabase();
  const existing = input.compKey
    ? await fetchExisting(input.userId, input.charKey, input.compKey)
    : null;

  // Read-modify-write: preserve any keys the bot manages, set the ones we own.
  const customStats: CompanionCustomStats = {
    ...(existing?.custom_stats ?? {}),
    kind: input.kind,
    art: input.art ?? existing?.custom_stats?.art ?? null,
  };
  if (input.kind === 'animal' || input.kind === 'mount')
    customStats.specialization = input.specialization ?? null;
  if (input.kind === 'familiar')
    customStats.familiar = {
      abilities: input.familiarAbilities ?? [],
      ...(input.familiarAbilityLimit ? { limit: input.familiarAbilityLimit } : {}),
    };
  if (input.kind === 'eidolon')
    customStats.eidolon = {
      type: input.eidolonType ?? '',
      build: input.eidolonBuild ?? 0,
      primaryName: input.eidolonPrimaryName,
      primaryDie: input.eidolonPrimaryDie,
    };
  if (input.kind === 'custom') customStats.custom = input.custom ?? existing?.custom_stats?.custom ?? {};

  const row = {
    user_id: input.userId,
    char_key: input.charKey,
    display_name: input.displayName,
    base_type: input.baseType,
    form: input.form,
    // `notes` is NOT NULL in the live table (defaults to ''), so never send null.
    notes: input.notes ?? existing?.notes ?? '',
    custom_stats: customStats,
    updated_at: new Date().toISOString(),
  };

  if (input.compKey) {
    // Edit: the caller holds a real comp_key, so replacing that row is the point.
    const { data, error } = await supabase
      .from('companions')
      .upsert({ ...row, comp_key: input.compKey }, { onConflict: 'user_id,char_key,comp_key' })
      .select(COLUMNS)
      .single();
    if (error) throw error;
    return data as CompanionRow;
  }

  const base = slugifyCompKey(input.displayName);
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const compKey = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const { data, error } = await supabase
      .from('companions')
      .insert({ ...row, comp_key: compKey })
      .select(COLUMNS)
      .single();
    if (!error) return data as CompanionRow;
    if (error.code !== '23505') throw error; // anything but unique_violation is real
  }
  throw new Error(
    `Couldn't find a free name-key for "${input.displayName}" — this character already has many companions with that name.`,
  );
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
