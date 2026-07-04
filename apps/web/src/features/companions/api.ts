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
  notes?: string | null;
  art?: string | null;
  /** Familiar: ability slugs. */
  familiarAbilities?: string[];
  /** Eidolon: subtype slug. */
  eidolonType?: string;
  /** Custom companion: a hand-entered stat block. */
  custom?: CustomCompanionStats;
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
  if (input.kind === 'eidolon') customStats.eidolon = { type: input.eidolonType ?? '' };
  if (input.kind === 'custom') customStats.custom = input.custom ?? existing?.custom_stats?.custom ?? {};

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
