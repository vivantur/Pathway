import { requireSupabase } from '@/lib/supabase';
import type { PathbuilderBuild } from './pathbuilder';
import { maxHp } from './pathbuilder';
import { preferRemaster } from './pf2eData/sourcePreference';
import type {
  AncestryRow,
  BagItem,
  CharacterBag,
  CharacterNoteEntry,
  CharacterOverlay,
  CharacterRow,
  CharacterSummary,
  ClassFeatureRow,
  DowntimeLogEntry,
  DowntimeRecord,
  ClassGamedata,
  FeatRow,
  HeritageRow,
  SpellRow,
} from './types';

const SUMMARY_COLUMNS =
  'id, char_key, name, source, current_hp, hero_points, experience, updated_at, art, level, ancestry_name, class_name';

const FULL_COLUMNS = [
  'id', 'user_id', 'char_key', 'name', 'source',
  'pathbuilder_data', 'pathbuilder_id',
  'ancestry_name', 'heritage_name', 'class_name', 'background_name', 'level',
  'current_hp', 'hero_points', 'dying', 'wounded', 'experience',
  'currency', 'overlay',
  'status', 'notes', 'art',
  'is_public', 'public_share_id',
  'updated_at',
].join(', ');

// Columns safe to expose over a PUBLIC share link. Deliberately EXCLUDES
// `user_id` (owner identity), `notes` (private bio), `pathbuilder_id`, `status`,
// and `overlay` — the overlay carries bot state including the XP log with
// Discord IDs. A public viewer gets the character showcase, not the owner's
// private/live data. (Ideal long-term: a server-side view/RPC so the column
// filter is enforced by the database, not just this query string.)
const PUBLIC_SHARE_COLUMNS = [
  'id', 'char_key', 'name', 'source',
  'pathbuilder_data',
  'ancestry_name', 'heritage_name', 'class_name', 'background_name', 'level',
  'current_hp', 'hero_points', 'dying', 'wounded', 'experience',
  'currency', 'art',
  'is_public', 'public_share_id',
  'updated_at',
].join(', ');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fetch the signed-in user's characters.
 *
 * MUST filter by `user_id` explicitly. It's tempting to rely on RLS alone —
 * and that WAS safe until the public-share policy (`is_public = true` readable
 * by everyone) was added. With that policy live, an unfiltered select returns
 * "my rows OR any public row in the whole database", so every public character
 * would leak into every user's vault. The explicit `user_id` predicate scopes
 * this to the owner regardless of how permissive RLS becomes.
 */
export async function fetchMyCharacters(userId: string): Promise<CharacterSummary[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('characters')
    .select(SUMMARY_COLUMNS)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as CharacterSummary[];
}

/**
 * Fetch one character by its stable per-user slug (`char_key`).
 *
 * RLS filters by owner automatically. Returns null when there's no match, so
 * "not found" (either doesn't exist or isn't yours) is a clean 404, not an
 * error that bubbles up as a red panel.
 */
export async function fetchCharacterByKey(
  charKey: string,
  userId: string,
): Promise<CharacterRow | null> {
  const supabase = requireSupabase();
  // Filter by user_id as well as char_key: char_key is only unique *per user*,
  // so two people can both have "seravi". With the public-share RLS policy
  // live, an unfiltered char_key match could return another user's public
  // character (or two rows → maybeSingle() error). Scoping to the owner keeps
  // this route strictly "my character".
  const { data, error } = await supabase
    .from('characters')
    .select(FULL_COLUMNS)
    .eq('user_id', userId)
    .eq('char_key', charKey)
    .maybeSingle();

  if (error) throw error;
  return (data as CharacterRow | null) ?? null;
}

/**
 * Load the note list for one character. `character_notes` is keyed by
 * `(user_id, char_key)`, not `character_id` — a bot-side artifact from before
 * characters had UUIDs. RLS already scopes reads to the owner.
 *
 * Notes come back as the raw JSONB array from the `notes` column; each entry
 * has at least `{id, ...}` but the "content" field name varies (text/body/
 * title) between the bot's early and current schemas, so callers should
 * normalize with `noteText()`.
 */
export async function fetchCharacterNotes(charKey: string): Promise<CharacterNoteEntry[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('character_notes')
    .select('notes')
    .eq('char_key', charKey)
    .maybeSingle();

  if (error) throw error;
  const raw = (data as { notes: unknown } | null)?.notes;
  return Array.isArray(raw) ? (raw as CharacterNoteEntry[]) : [];
}

/** Best-effort content extraction — the bot changed schemas mid-life. */
export function noteText(n: CharacterNoteEntry): string {
  return String(n.text ?? n.body ?? n.title ?? '').trim();
}

/** The whole `character_notes` book for one character: the note list + the
 *  monotonic id counter the bot uses to assign new note ids. */
export interface CharacterNoteBook {
  nextId: number;
  notes: CharacterNoteEntry[];
}

/**
 * Read-modify-write one character's `character_notes` book with the same
 * compare-and-swap discipline as the overlay: the bot writes this row too
 * (adding notes from Discord), so a blind full-list write from a stale copy
 * would erase a concurrent bot note. We re-read the freshest book, apply the
 * caller's `mutate`, and write conditionally on `updated_at`, retrying if
 * another writer slipped in. The row may not exist yet (a character with no
 * notes), so we insert on the first write.
 *
 * `char_key` is the natural key here (the table predates character UUIDs); RLS
 * scopes the row to the owner, and we pass `user_id` explicitly on insert.
 */
export async function updateCharacterNotes(input: {
  userId: string;
  charKey: string;
  mutate: (book: CharacterNoteBook) => CharacterNoteBook;
}): Promise<CharacterNoteBook> {
  const supabase = requireSupabase();
  const { userId, charKey, mutate } = input;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: fresh, error: readError } = await supabase
      .from('character_notes')
      .select('next_id, notes, updated_at')
      .eq('char_key', charKey)
      .maybeSingle();
    if (readError) throw readError;

    const row = fresh as { next_id: number | null; notes: unknown; updated_at: string | null } | null;
    const current: CharacterNoteBook = {
      nextId: row?.next_id ?? 1,
      notes: Array.isArray(row?.notes) ? (row!.notes as CharacterNoteEntry[]) : [],
    };
    const next = mutate(current);
    const payload = {
      user_id: userId,
      char_key: charKey,
      next_id: next.nextId,
      notes: next.notes,
      updated_at: new Date().toISOString(),
    };

    if (!row) {
      // No book yet — insert. A concurrent insert loses the unique-key race
      // (23505); loop and fall through to the update path on the next attempt.
      const { error: insertError } = await supabase.from('character_notes').insert(payload);
      if (!insertError) return next;
      if ((insertError as { code?: string }).code !== '23505') throw insertError;
      continue;
    }

    let write = supabase
      .from('character_notes')
      .update(payload)
      .eq('user_id', userId)
      .eq('char_key', charKey);
    write = row.updated_at == null ? write.is('updated_at', null) : write.eq('updated_at', row.updated_at);
    const { data: written, error: writeError } = await write.select('char_key');
    if (writeError) throw writeError;
    if (written && written.length > 0) return next;
    // Zero rows updated → a concurrent write changed updated_at; retry.
  }

  throw new Error(
    'Could not save your note — the character was being updated somewhere else. Please try again.',
  );
}

/** The storage bucket that holds player-uploaded portraits. */
const PORTRAIT_BUCKET = 'portraits';

/** Accepted portrait types, keep in sync with the bucket's MIME allow-list. */
export const PORTRAIT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

/** 5 MB cap to keep the CDN happy and avoid slow first-loads on mobile. */
export const PORTRAIT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Upload a portrait image and update the character's `art` column to the
 * public URL. Storage path is `<user_id>/<char_key>-<timestamp>.<ext>` — the
 * timestamp busts cached URLs so a re-upload shows up immediately without
 * needing a browser hard-refresh, and the folder segment matches the storage
 * RLS policy (`(storage.foldername(name))[1] = auth.uid()::text`).
 *
 * Returns the new public URL so the caller can optimistically update UI
 * without a refetch.
 */
export async function uploadCharacterPortrait(input: {
  userId: string;
  charKey: string;
  file: File;
}): Promise<string> {
  const { userId, charKey, file } = input;

  if (!PORTRAIT_MIME_TYPES.includes(file.type as (typeof PORTRAIT_MIME_TYPES)[number])) {
    throw new Error(
      `Unsupported image type "${file.type || 'unknown'}". Use JPG, PNG, WebP, or GIF.`,
    );
  }
  if (file.size > PORTRAIT_MAX_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(`Image is ${mb} MB. Portraits must be under 5 MB.`);
  }

  const supabase = requireSupabase();
  const ext = extensionFor(file);
  const path = `${userId}/${charKey}-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(PORTRAIT_BUCKET)
    .upload(path, file, { cacheControl: '3600', contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;

  const { data: pub } = supabase.storage.from(PORTRAIT_BUCKET).getPublicUrl(path);
  const publicUrl = pub.publicUrl;
  if (!publicUrl) throw new Error("Couldn't resolve the portrait's public URL.");

  const { error: updateError } = await supabase
    .from('characters')
    .update({ art: publicUrl })
    .eq('user_id', userId)
    .eq('char_key', charKey);
  if (updateError) throw updateError;

  return publicUrl;
}

// -------------------------------------------------------------------------
// Downtime bank: spendable days + audit log (bot-managed `downtime` table)
// -------------------------------------------------------------------------

/** Hard cap on banked downtime days — mirrors the bot's `/downtime` rules. */
export const DOWNTIME_MAX_BANK = 200;

/**
 * Load one character's downtime bank. Keyed by `char_key` (the table predates
 * character UUIDs); RLS scopes it to the owner. Returns an empty bank when no
 * row exists yet.
 */
export async function fetchCharacterDowntime(charKey: string): Promise<DowntimeRecord> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('downtime')
    .select('bank, last_accrual_date, log')
    .eq('char_key', charKey)
    .maybeSingle();
  if (error) throw error;
  const row = data as { bank: number | null; last_accrual_date: string | null; log: unknown } | null;
  return {
    bank: row?.bank ?? 0,
    lastAccrualDate: row?.last_accrual_date ?? null,
    log: Array.isArray(row?.log) ? (row!.log as DowntimeLogEntry[]) : [],
  };
}

/**
 * Read-modify-write a character's downtime row with compare-and-swap (same
 * anti-clobber discipline as the overlay/notes): the bot grants/spends/accrues
 * downtime too, so we re-read the freshest bank, apply the caller's `mutate`,
 * and write conditionally on `updated_at`, retrying on conflict. Inserts the
 * row on first write.
 */
export async function updateCharacterDowntime(input: {
  userId: string;
  charKey: string;
  mutate: (record: DowntimeRecord) => DowntimeRecord;
}): Promise<DowntimeRecord> {
  const supabase = requireSupabase();
  const { userId, charKey, mutate } = input;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: fresh, error: readError } = await supabase
      .from('downtime')
      .select('bank, last_accrual_date, log, updated_at')
      .eq('char_key', charKey)
      .maybeSingle();
    if (readError) throw readError;

    const row = fresh as
      | { bank: number | null; last_accrual_date: string | null; log: unknown; updated_at: string | null }
      | null;
    const current: DowntimeRecord = {
      bank: row?.bank ?? 0,
      lastAccrualDate: row?.last_accrual_date ?? null,
      log: Array.isArray(row?.log) ? (row!.log as DowntimeLogEntry[]) : [],
    };
    const next = mutate(current);
    const payload = {
      user_id: userId,
      char_key: charKey,
      bank: next.bank,
      // Seed today's date on a first write (mirrors the bot's getCharRecord).
      // A fresh record has no accrual date; the column is a NOT-NULL `date`, so
      // sending null made the very first grant (a character with no downtime row
      // yet — "0 days banked") fail its INSERT and silently revert. Anchoring to
      // today also means no accrual windfall on first use.
      last_accrual_date: next.lastAccrualDate ?? new Date().toISOString().slice(0, 10),
      log: next.log,
      updated_at: new Date().toISOString(),
    };

    if (!row) {
      const { error: insertError } = await supabase.from('downtime').insert(payload);
      if (!insertError) return next;
      if ((insertError as { code?: string }).code !== '23505') throw insertError;
      continue;
    }

    let write = supabase
      .from('downtime')
      .update(payload)
      .eq('user_id', userId)
      .eq('char_key', charKey);
    write = row.updated_at == null ? write.is('updated_at', null) : write.eq('updated_at', row.updated_at);
    const { data: written, error: writeError } = await write.select('char_key');
    if (writeError) throw writeError;
    if (written && written.length > 0) return next;
    // Zero rows updated → a concurrent write changed updated_at; retry.
  }

  throw new Error(
    'Could not update downtime — the character was being updated somewhere else. Please try again.',
  );
}

// -------------------------------------------------------------------------
// Loot bag: the bot's normalized bags + bag_items (per character)
// -------------------------------------------------------------------------

/** Escape LIKE/ILIKE wildcards so a user's `%`/`_` are matched literally. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&');
}

/** One match in the "add an item" picker. */
export interface ItemPickResult {
  id: string | number;
  name: string;
}

/**
 * Load one character's loot bag (bag name + items), keyed by `char_key` — the
 * bot keys modern per-character bags this way (`makeBagKey(userId, charKey)`).
 * RLS scopes both tables to the owner. Legacy per-user bags (the bot's
 * `__legacy__` char_key) are intentionally not surfaced on a character sheet.
 */
export async function fetchCharacterBag(charKey: string): Promise<CharacterBag> {
  const supabase = requireSupabase();
  const [{ data: bagRow, error: bagErr }, { data: itemRows, error: itemErr }] = await Promise.all([
    supabase.from('bags').select('bag_name').eq('char_key', charKey).maybeSingle(),
    supabase
      .from('bag_items')
      .select('id, category, display_name, quantity, sort_order')
      .eq('char_key', charKey)
      .order('sort_order', { ascending: true }),
  ]);
  if (bagErr) throw bagErr;
  if (itemErr) throw itemErr;

  const items: BagItem[] = ((itemRows ?? []) as Array<{
    id: string | number;
    category: string | null;
    display_name: string | null;
    quantity: number | null;
  }>).map((r) => ({
    id: r.id,
    category: r.category ?? 'General',
    displayName: r.display_name ?? '',
    quantity: r.quantity ?? 1,
  }));

  return { bagName: (bagRow as { bag_name: string | null } | null)?.bag_name ?? 'Bag', items };
}

/** Case-insensitive item-name search for the "add to bag" picker. */
export async function searchItemsForPicker(query: string): Promise<ItemPickResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('items')
    .select('id, name')
    .ilike('name', `%${escapeLike(q)}%`)
    .order('name')
    .limit(30);
  if (error) throw error;

  const seen = new Set<string>();
  const out: ItemPickResult[] = [];
  for (const r of (data ?? []) as Array<{ id: string | number; name: string }>) {
    const k = r.name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ id: r.id, name: r.name });
  }
  return out;
}

/**
 * Add an item to a character's bag. Ensures the `bags` row exists first (so the
 * bot lists the bag) WITHOUT overwriting an existing bag name, then inserts one
 * `bag_items` row — linking `item_id` when the item came from the archive, or
 * storing a `custom_name` for free-text entries, matching the bot's shape.
 */
export async function addBagItem(input: {
  userId: string;
  charKey: string;
  category: string;
  name: string;
  itemId?: string | number | null;
  quantity: number;
}): Promise<void> {
  const supabase = requireSupabase();
  const { userId, charKey } = input;
  const name = input.name.trim();
  if (!name) throw new Error('Give the item a name.');

  // Insert the bag row only if absent — never clobber a renamed bag.
  const { error: bagError } = await supabase.from('bags').upsert(
    { user_id: userId, char_key: charKey, bag_name: 'Bag', categories: {} },
    { onConflict: 'user_id,char_key', ignoreDuplicates: true },
  );
  if (bagError) throw bagError;

  const { count } = await supabase
    .from('bag_items')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('char_key', charKey);

  const { error } = await supabase.from('bag_items').insert({
    user_id: userId,
    char_key: charKey,
    category: input.category.trim() || 'General',
    item_id: input.itemId ?? null,
    homebrew_id: null,
    custom_name: input.itemId ? null : name,
    display_name: name,
    quantity: Math.max(1, Math.floor(input.quantity) || 1),
    sort_order: count ?? 0,
  });
  if (error) throw error;
}

/** Set a bag item's quantity, or remove the row when it drops to zero. */
export async function setBagItemQuantity(input: {
  rowId: string | number;
  quantity: number;
}): Promise<void> {
  if (input.quantity <= 0) return removeBagItem({ rowId: input.rowId });
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('bag_items')
    .update({ quantity: Math.floor(input.quantity) })
    .eq('id', input.rowId);
  if (error) throw error;
}

/** Remove one item row from a bag. RLS scopes the delete to the owner. */
export async function removeBagItem(input: { rowId: string | number }): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('bag_items').delete().eq('id', input.rowId);
  if (error) throw error;
}

// -------------------------------------------------------------------------
// Reference data: ancestry + heritage + ancestry feats
// -------------------------------------------------------------------------

/**
 * Bundle everything the Ancestry tab needs in one call so the tab is a single
 * useQuery. Uses SELECT * for ancestry + heritages because the exact column
 * set isn't fully audited yet — the UI reads the fields defensively.
 *
 * Heritage linkage assumes `heritages.ancestry_id` (normalized FK). If your
 * bot uses a text column instead we'll see empty heritage results and swap
 * the query — cheap fix.
 *
 * Ancestry feats are pulled from `feats` where `feat_type = 'ancestry'` AND
 * the ancestry name appears in the `traits` jsonb array. Case is checked
 * both ways so "Elf" / "elf" both match.
 */
export interface AncestryBundle {
  ancestry: AncestryRow | null;
  heritages: HeritageRow[];
  ancestryFeats: FeatRow[];
}

export async function fetchAncestryBundle(input: {
  ancestryName: string;
  characterLevel: number;
}): Promise<AncestryBundle> {
  const { ancestryName, characterLevel } = input;
  const supabase = requireSupabase();

  // Fetch up to a handful of candidates, then let preferRemaster pick the
  // Remaster row when both exist. Grouping is by name so Legacy-only
  // ancestries still make it through.
  const { data: ancestryRows, error: ancestryError } = await supabase
    .from('ancestries')
    .select('*')
    .ilike('name', ancestryName)
    .order('id', { ascending: true })
    .limit(5);
  if (ancestryError) throw ancestryError;
  const ancestryCandidates = ((ancestryRows ?? []) as AncestryRow[]);
  const ancestry = preferRemaster(ancestryCandidates)[0] ?? null;

  let heritages: HeritageRow[] = [];
  if (ancestry?.id) {
    const { data: heritageRows } = await supabase
      .from('heritages')
      .select('*')
      .eq('ancestry_id', ancestry.id)
      .order('name');
    heritages = (heritageRows ?? []) as HeritageRow[];
  }
  // Fallback: some schemas link heritages by ancestry name instead of id.
  if (heritages.length === 0) {
    const { data: heritageRowsByName } = await supabase
      .from('heritages')
      .select('*')
      .ilike('ancestry_name', ancestryName)
      .order('name');
    heritages = (heritageRowsByName ?? []) as HeritageRow[];
  }
  // Collapse Legacy + Remaster twins to just Remaster, keeping the sort.
  heritages = preferRemaster(heritages);

  // Ancestry feats: try both casings of the trait tag.
  const lowerName = ancestryName.trim().toLowerCase();
  const properName =
    lowerName.charAt(0).toUpperCase() + lowerName.slice(1);

  const { data: featsA } = await supabase
    .from('feats')
    .select('id, name, description, feat_type, level, traits, prerequisites, action_cost, trigger, rarity, source, aon_id, aon_url')
    .eq('feat_type', 'ancestry')
    .lte('level', characterLevel)
    .contains('traits', [lowerName])
    .order('level');
  const { data: featsB } = await supabase
    .from('feats')
    .select('id, name, description, feat_type, level, traits, prerequisites, action_cost, trigger, rarity, source, aon_id, aon_url')
    .eq('feat_type', 'ancestry')
    .lte('level', characterLevel)
    .contains('traits', [properName])
    .order('level');

  const dedupe = new Map<string, FeatRow>();
  for (const f of [...(featsA ?? []), ...(featsB ?? [])] as FeatRow[]) {
    if (!dedupe.has(f.id)) dedupe.set(f.id, f);
  }
  const ancestryFeats = preferRemaster(
    Array.from(dedupe.values()).sort(
      (a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name),
    ),
  );

  return { ancestry, heritages, ancestryFeats };
}

// -------------------------------------------------------------------------
// Reference data: class overview + class features + class feats
// -------------------------------------------------------------------------

/** Everything the Class tab reads in one round-trip. */
export interface ClassBundle {
  classInfo: ClassGamedata | null;
  features: ClassFeatureRow[];
  feats: FeatRow[];
}

/**
 * Load a class's overview, its level-eligible class features, and its
 * level-eligible class feats in one bundled call. Class lookup uses
 * `gamedata` (category='classes'); features/feats use the typed tables
 * filtered by the class name as a trait — tried in both lowercase and
 * capitalized casing to survive inconsistent tagging.
 */
export async function fetchClassBundle(input: {
  className: string;
  characterLevel: number;
}): Promise<ClassBundle> {
  const { className, characterLevel } = input;
  const supabase = requireSupabase();

  // Grab all matching gamedata rows (Fighter typically shows up twice —
  // Legacy + Remaster). Handing them to preferRemaster picks the Remaster
  // row when one exists and falls back to the older id otherwise. The
  // gamedata "source" lives inside the JSONB `data`, so we shape a light
  // wrapper for the helper.
  const { data: classRows, error: classError } = await supabase
    .from('gamedata')
    .select('id, category, slug, name, data, updated_at')
    .eq('category', 'classes')
    .ilike('name', className)
    .order('id', { ascending: true })
    .limit(5);
  if (classError) throw classError;

  const classCandidates = ((classRows ?? []) as ClassGamedata[]).map((row) => ({
    row,
    name: row.name,
    source: typeof row.data?.source === 'string' ? (row.data.source as string) : null,
  }));
  const classInfo = preferRemaster(classCandidates)[0]?.row ?? null;

  const lower = className.trim().toLowerCase();
  const proper = lower.charAt(0).toUpperCase() + lower.slice(1);

  const featuresSelect =
    'id, aon_id, aon_url, character_class_id, archetype_id, name, level, description, traits, is_choice, rarity, source, is_official, class_feature_metadata';

  const [featuresA, featuresB] = await Promise.all([
    supabase
      .from('class_features')
      .select(featuresSelect)
      .lte('level', characterLevel)
      .contains('traits', [lower])
      .order('level'),
    supabase
      .from('class_features')
      .select(featuresSelect)
      .lte('level', characterLevel)
      .contains('traits', [proper])
      .order('level'),
  ]);

  const featureDedupe = new Map<string, ClassFeatureRow>();
  for (const f of [...(featuresA.data ?? []), ...(featuresB.data ?? [])] as ClassFeatureRow[]) {
    if (!featureDedupe.has(f.id)) featureDedupe.set(f.id, f);
  }
  const features = preferRemaster(
    Array.from(featureDedupe.values()).sort(
      (a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name),
    ),
  );

  const featsSelect =
    'id, name, description, feat_type, level, traits, prerequisites, action_cost, trigger, rarity, source, aon_id, aon_url';

  const [featsA, featsB] = await Promise.all([
    supabase
      .from('feats')
      .select(featsSelect)
      .eq('feat_type', 'class')
      .lte('level', characterLevel)
      .contains('traits', [lower])
      .order('level'),
    supabase
      .from('feats')
      .select(featsSelect)
      .eq('feat_type', 'class')
      .lte('level', characterLevel)
      .contains('traits', [proper])
      .order('level'),
  ]);

  const featDedupe = new Map<string, FeatRow>();
  for (const f of [...(featsA.data ?? []), ...(featsB.data ?? [])] as FeatRow[]) {
    if (!featDedupe.has(f.id)) featDedupe.set(f.id, f);
  }
  const feats = preferRemaster(
    Array.from(featDedupe.values()).sort(
      (a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name),
    ),
  );

  return { classInfo, features, feats };
}

// -------------------------------------------------------------------------
// Reference data: batch feat lookup by name
// -------------------------------------------------------------------------

/**
 * Batch-fetch feat rows for a list of names. Used by the Feats tab: the
 * character's build has feat names but no descriptions/prereqs, so we
 * hydrate them against the reference table in one round-trip.
 *
 * Uses `.in('name', ...)` which is case-sensitive; the caller can query
 * both a lowercase and a Title Case pass if needed, but in practice the
 * bot and Pathbuilder both write feats in Title Case, matching what the
 * reference table stores.
 *
 * De-duplicated via preferRemaster so Legacy + Remaster twins collapse.
 */
export async function fetchFeatsByNames(names: string[]): Promise<FeatRow[]> {
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  if (unique.length === 0) return [];
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('feats')
    .select(
      'id, name, description, feat_type, level, traits, prerequisites, action_cost, trigger, rarity, source, aon_id, aon_url',
    )
    .in('name', unique);
  if (error) throw error;
  return preferRemaster((data ?? []) as FeatRow[]);
}

/**
 * Batch-fetch spell rows for a list of names. Same pattern as
 * fetchFeatsByNames — one round-trip via `.in('name', ...)`, then
 * preferRemaster collapses Legacy + Remaster twins.
 *
 * Uses SELECT * because the spells table's exact column set isn't audited
 * yet and PF2e spells have a lot of PF-specific fields (range, area,
 * targets, saving_throw, duration, heightened, etc.) — the SpellsTab
 * reads them defensively via pickString helpers.
 */
export async function fetchSpellsByNames(names: string[]): Promise<SpellRow[]> {
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  if (unique.length === 0) return [];
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('spells')
    .select('*')
    .in('name', unique);
  if (error) throw error;
  return preferRemaster((data ?? []) as SpellRow[]);
}

/** One match in the "add a spell" picker. */
export interface SpellPickResult {
  name: string;
  rank: number;
  traits: string[];
}

/**
 * Case-insensitive name search of the spells archive for the sheet's
 * "add a spell" picker. Dedupes Legacy/Remaster twins via preferRemaster and
 * returns a light shape (name + rank + traits) sorted by rank then name.
 */
export async function searchSpellsForPicker(query: string): Promise<SpellPickResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const supabase = requireSupabase();
  // SELECT * — the spells table's exact column set isn't audited (see
  // fetchSpellsByNames), so naming columns that don't exist would 400 the
  // whole query and silently return nothing. Read defensively below.
  const { data, error } = await supabase
    .from('spells')
    .select('*')
    .ilike('name', `%${q}%`)
    .limit(40);
  if (error) throw error;

  const rows = preferRemaster((data ?? []) as SpellRow[]);
  const seen = new Set<string>();
  const out: SpellPickResult[] = [];
  for (const r of rows) {
    const key = r.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const rank = r.rank ?? r.level ?? r.spell_level ?? 0;
    out.push({
      name: r.name,
      rank: typeof rank === 'number' ? rank : 0,
      traits: Array.isArray(r.traits) ? r.traits.filter((t): t is string => typeof t === 'string') : [],
    });
  }
  return out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
}

// -------------------------------------------------------------------------
// Self-relink: claim bot characters for the signed-in Discord identity
// -------------------------------------------------------------------------

export type RelinkStatus =
  | 'linked'
  | 'already_linked'
  | 'created'
  | 'no_bot_identity'
  | 'no_discord_id'
  | 'conflict'
  | 'not_authenticated';

export interface RelinkResult {
  status: RelinkStatus;
  /** Characters owned after the call (present for linked / already_linked). */
  characters?: number;
  /** The bot users.id that was rewritten (present for linked). */
  previous_id?: string;
  detail?: string;
}

/**
 * Call the `relink_current_user()` Postgres function, which matches the
 * caller's verified Discord id to their bot `users` row and rewrites the
 * bot id to the web `auth.uid()` (cascading ownership of all their
 * characters). Idempotent — safe to call on every login.
 */
export async function relinkCurrentUser(): Promise<RelinkResult> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('relink_current_user');
  if (error) throw error;
  return (data as RelinkResult) ?? { status: 'no_bot_identity' };
}

// -------------------------------------------------------------------------
// Edit live state: HP / hero points / dying / wounded / XP / notes
// -------------------------------------------------------------------------

/**
 * The player-editable "live state" fields. These are dedicated columns (the
 * canonical source per web-bot-sync.md §3), NOT inside pathbuilder_data — so a
 * plain column UPDATE is safe and never fights the build. The `overlay`
 * (bot-managed conditions, xp log, counters) is deliberately untouched.
 */
export interface CharacterStatePatch {
  current_hp?: number | null;
  hero_points?: number | null;
  dying?: number | null;
  wounded?: number | null;
  experience?: number | null;
  notes?: string | null;
  /**
   * Coin purse. This is a jsonb column, so a write REPLACES the whole object —
   * callers must send all four denominations, not a partial patch.
   */
  currency?: { pp?: number; gp?: number; sp?: number; cp?: number } | null;
}

/**
 * Write a live-state patch to one owned character. RLS + the explicit
 * (user_id, char_key) predicate keep it scoped to the owner. Stamps
 * updated_at so Realtime subscribers (other open web sheets) refresh.
 */
export async function updateCharacterState(input: {
  userId: string;
  charKey: string;
  patch: CharacterStatePatch;
}): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('characters')
    .update({ ...input.patch, updated_at: new Date().toISOString() })
    .eq('user_id', input.userId)
    .eq('char_key', input.charKey);
  if (error) throw error;
}

/**
 * Read-modify-write one owned character's `overlay` blob with optimistic
 * concurrency (compare-and-swap on `updated_at`).
 *
 * The overlay is a single JSONB column that BOTH clients write: the bot owns
 * `pathway_bot_state` (xp, xpLog, counters) while the web owns `web_edits`
 * (added spells, conditions) and adjusts focus/counters. A naive "write the
 * whole blob computed from a cached copy" loses data: if the bot awards XP
 * between the web's read and its write, the web's stale blob overwrites the
 * bot's award.
 *
 * To make that safe, the caller passes a `mutate` function instead of a final
 * blob. We fetch the FRESHEST overlay, apply `mutate` to it (so the caller's
 * change merges onto whatever the bot just wrote), and write conditionally on
 * the `updated_at` we read. If another writer slipped in between, the update
 * matches zero rows and we retry against the new state. Because `mutate` only
 * rewrites its own sub-tree of the fresh overlay, concurrent writes to other
 * sub-trees survive.
 */
export async function updateCharacterOverlay(input: {
  userId: string;
  charKey: string;
  mutate: (current: CharacterOverlay) => CharacterOverlay;
}): Promise<CharacterOverlay> {
  const supabase = requireSupabase();
  const { userId, charKey, mutate } = input;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: fresh, error: readError } = await supabase
      .from('characters')
      .select('overlay, updated_at')
      .eq('user_id', userId)
      .eq('char_key', charKey)
      .single();
    if (readError) throw readError;

    const row = fresh as { overlay: CharacterOverlay | null; updated_at: string | null };
    const current = (row.overlay ?? {}) as CharacterOverlay;
    const next = mutate(current);

    let write = supabase
      .from('characters')
      .update({ overlay: next, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('char_key', charKey);
    // CAS guard: only commit if nobody has bumped updated_at since our read.
    write = row.updated_at == null ? write.is('updated_at', null) : write.eq('updated_at', row.updated_at);

    const { data: written, error: writeError } = await write.select('overlay');
    if (writeError) throw writeError;
    if (written && written.length > 0) {
      return (written[0] as { overlay: CharacterOverlay }).overlay;
    }
    // Zero rows updated → a concurrent write changed updated_at; loop and retry.
  }

  throw new Error(
    'Could not save your change — the character was being updated somewhere else. Please try again.',
  );
}

// -------------------------------------------------------------------------
// Public share lookup: fetch by public_share_id without auth
// -------------------------------------------------------------------------

/**
 * Fetch a character by its public share UUID. Bypasses "must be signed in
 * as owner" because the RLS policy `is_public = true` opens anon reads for
 * this exact case. We ALSO filter `is_public = true` in the query for
 * belt-and-suspenders — if a share URL leaks after the owner has turned
 * sharing off, the extra predicate returns null instead of the row.
 *
 * Returns null when nothing matches OR when the row exists but sharing is
 * off — the caller renders a friendly "not shared / no longer shared" page
 * either way.
 */
export async function fetchPublicCharacterByShareId(
  shareId: string,
): Promise<CharacterRow | null> {
  // A malformed share id (hand-typed /share/<garbage>) isn't a valid UUID; short-
  // circuit to a clean "not shared" null instead of a Postgres 22P02 error panel.
  if (!UUID_RE.test(shareId)) return null;
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('characters')
    .select(PUBLIC_SHARE_COLUMNS) // NOT FULL_COLUMNS — never ship private columns to anon viewers.
    .eq('public_share_id', shareId)
    .eq('is_public', true)
    .maybeSingle();
  if (error) throw error;
  return (data as CharacterRow | null) ?? null;
}

// -------------------------------------------------------------------------
// Find existing character by Pathbuilder id (for the update-on-reimport flow)
// -------------------------------------------------------------------------

export interface ExistingCharacterMatch {
  id: string;
  char_key: string;
  name: string;
  updated_at: string | null;
}

/**
 * Check if the signed-in user already imported this exact Pathbuilder id.
 * Used by the /vault/new page to offer "Update existing" instead of
 * silently creating a duplicate. Scoped to `user_id` EXPLICITLY (not RLS
 * alone): the public-share policy makes another user's public row with the
 * same pathbuilder_id readable, which would show a false "existing match".
 */
export async function findCharacterByPathbuilderId(
  userId: string,
  pathbuilderId: number,
): Promise<ExistingCharacterMatch | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('characters')
    .select('id, char_key, name, updated_at')
    .eq('user_id', userId)
    .eq('pathbuilder_id', pathbuilderId)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const first = (data ?? [])[0];
  return (first as ExistingCharacterMatch | undefined) ?? null;
}

// -------------------------------------------------------------------------
// Update character from a fetched Pathbuilder build (preserves live state)
// -------------------------------------------------------------------------

export interface UpdateCharacterFromBuildInput {
  userId: string;
  charKey: string;
  build: PathbuilderBuild;
  /** Only set when re-syncing from Pathbuilder; omitted for web edits so we
   * don't overwrite an existing link with null. */
  pathbuilderId?: number;
}

/**
 * Re-sync an existing character's build fields from a fresh Pathbuilder
 * export while PRESERVING everything the bot / player has changed since:
 *   - current_hp / hero_points / dying / wounded (combat state)
 *   - experience (XP progression)
 *   - currency (loot spent/earned since import)
 *   - overlay (bot-managed conditions, counters, XP log)
 *   - art (portrait uploads)
 *   - notes (bio text)
 *   - is_public / public_share_id (sharing state)
 *
 * We only touch pathbuilder_data, pathbuilder_id, and the denormalized
 * name/ancestry/heritage/class/background/level columns. If the character's
 * name has changed in Pathbuilder we let it change here too — but char_key
 * stays stable so existing URLs and vault card positions don't break.
 */
export async function updateCharacterFromBuild(
  input: UpdateCharacterFromBuildInput,
): Promise<CreateCharacterResult> {
  const { userId, charKey, build, pathbuilderId } = input;
  const supabase = requireSupabase();

  const updates = {
    pathbuilder_data: build,
    // Only overwrite the Pathbuilder link when a new id is supplied.
    ...(pathbuilderId != null ? { pathbuilder_id: pathbuilderId } : {}),
    name: (build.name ?? '').trim() || 'Unnamed Character',
    ancestry_name: build.ancestry ?? null,
    heritage_name: build.heritage ?? null,
    class_name: build.class ?? null,
    background_name: build.background ?? null,
    level: build.level ?? 1,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('characters')
    .update(updates)
    .eq('user_id', userId)
    .eq('char_key', charKey)
    .select('id, char_key, name')
    .single();

  if (error) throw error;
  return data as CreateCharacterResult;
}

// -------------------------------------------------------------------------
// Delete character
// -------------------------------------------------------------------------

/**
 * Delete one character owned by the signed-in user. RLS enforces owner
 * scoping so a stray char_key can't nuke someone else's row.
 */
export async function deleteCharacter(input: {
  userId: string;
  charKey: string;
}): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('characters')
    .delete()
    .eq('user_id', input.userId)
    .eq('char_key', input.charKey);
  if (error) throw error;
}

// -------------------------------------------------------------------------
// Toggle public sharing (writes is_public + generates a share id if missing)
// -------------------------------------------------------------------------

export interface SetPublicResult {
  is_public: boolean;
  public_share_id: string | null;
}

/**
 * Flip a character's `is_public` flag. When making a character public for the
 * first time we generate a `public_share_id` UUID that becomes the stable
 * shareable-URL segment. Subsequent toggles never re-generate the id so
 * anyone with the previous link keeps their access when the character is
 * turned public again.
 */
export async function setCharacterPublic(input: {
  userId: string;
  charKey: string;
  isPublic: boolean;
}): Promise<SetPublicResult> {
  const supabase = requireSupabase();

  // Fetch the existing share id (if any) so we know whether to generate one.
  const { data: existing, error: fetchError } = await supabase
    .from('characters')
    .select('public_share_id')
    .eq('user_id', input.userId)
    .eq('char_key', input.charKey)
    .maybeSingle();
  if (fetchError) throw fetchError;

  const shareId =
    (existing as { public_share_id: string | null } | null)?.public_share_id ??
    (input.isPublic ? crypto.randomUUID() : null);

  const { data, error } = await supabase
    .from('characters')
    .update({
      is_public: input.isPublic,
      public_share_id: shareId,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', input.userId)
    .eq('char_key', input.charKey)
    .select('is_public, public_share_id')
    .single();
  if (error) throw error;
  return data as SetPublicResult;
}

// -------------------------------------------------------------------------
// Create character: from a fetched Pathbuilder build
// -------------------------------------------------------------------------

export interface CreateCharacterFromBuildInput {
  userId: string;
  build: PathbuilderBuild;
  /** Pathbuilder cloud id when imported; omitted for characters built on the web. */
  pathbuilderId?: number;
}

export interface CreateCharacterResult {
  id: string;
  char_key: string;
  name: string;
}

/**
 * Insert a new character row from a fetched Pathbuilder build.
 *
 * Extracts the denormalized fields (name/ancestry/heritage/class/background/
 * level) so vault + header displays don't have to parse the JSONB. Generates
 * a URL-safe char_key from the name and appends `-2`, `-3`, ... if the user
 * already has a character at that key. Seeds live-state columns to sensible
 * defaults: current_hp = maxHp(build), hero_points = 1, dying/wounded = 0,
 * experience = 0.
 *
 * RLS should already scope the insert to `user_id = auth.uid()`; if you
 * haven't added the INSERT policy yet, this call will error with a
 * "new row violates row-level security policy" message.
 */
export async function createCharacterFromBuild(
  input: CreateCharacterFromBuildInput,
): Promise<CreateCharacterResult> {
  const { userId, build, pathbuilderId } = input;
  const supabase = requireSupabase();

  const name = (build.name ?? '').trim() || 'Unnamed Character';
  const level = build.level ?? 1;

  const baseKey = slugify(name);
  const charKey = await findAvailableCharKey(userId, baseKey);

  const initialHp = maxHp(build) ?? null;

  const insertPayload = {
    user_id: userId,
    char_key: charKey,
    name,
    // The live `characters_source_check` constraint only permits known origin
    // tags (e.g. 'pathbuilder'); web-built characters are stored in the same
    // Pathbuilder-format `pathbuilder_data`, so we use 'pathbuilder' here too.
    source: 'pathbuilder',
    status: 'active',
    pathbuilder_id: pathbuilderId ?? null,
    pathbuilder_data: build,
    ancestry_name: build.ancestry ?? null,
    heritage_name: build.heritage ?? null,
    class_name: build.class ?? null,
    background_name: build.background ?? null,
    level,
    current_hp: initialHp,
    hero_points: 1,
    dying: 0,
    wounded: 0,
    experience: 0,
    // Seed a bot-compatible overlay. Without pathway_bot_state the bot
    // treats the character as "not managed by me" and hides it from
    // vault/list commands. Structure mirrors what the bot writes on its
    // own — empty edits / xpLog / counters, hero_points = 1, and a fresh
    // pathwayWebId so the bot has a stable per-character key to hang state
    // off of.
    overlay: defaultBotOverlay(),
  };

  const { data, error } = await supabase
    .from('characters')
    .insert(insertPayload)
    .select('id, char_key, name')
    .single();

  if (error) throw error;
  return data as CreateCharacterResult;
}

/**
 * Look up the current char_keys the user already has that start with
 * `baseKey`, then pick the smallest unused suffix. This is one round-trip
 * with a `LIKE 'base%'` filter (much cheaper than probing each candidate).
 */
async function findAvailableCharKey(userId: string, baseKey: string): Promise<string> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('characters')
    .select('char_key')
    .eq('user_id', userId)
    .like('char_key', `${baseKey}%`);
  if (error) throw error;

  const taken = new Set((data ?? []).map((r) => (r as { char_key: string }).char_key));
  if (!taken.has(baseKey)) return baseKey;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${baseKey}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Absurd fallback — should never happen in practice.
  return `${baseKey}-${Date.now()}`;
}

/**
 * Fresh `overlay` blob for a newly-imported character.
 *
 * The bot filters vault/list commands by the presence of a fully-formed
 * `pathway_bot_state` — a character without it renders invisible in
 * Discord even though the row is visible via RLS. This helper produces
 * the same shape the bot writes when it creates a character natively:
 * empty edits (stats/senses/weapons/languages/skillOverrides), empty
 * xpLog, empty counters, hero_points seeded to 1, and a stable
 * pathwayWebId UUID that the bot uses as its per-character identifier.
 *
 * Called on INSERT only — updateCharacterFromBuild deliberately does
 * NOT touch overlay so the bot's accumulated state (xp log, counters,
 * senses edits, etc.) survives re-imports.
 */
function defaultBotOverlay(): Record<string, unknown> {
  return {
    cvars: {},
    daily: {
      slots_used: {},
      focus_spent: 0,
      hero_points: 1,
    },
    counters: {},
    spellbook: [],
    repertoire_swaps: [],
    pathway_bot_state: {
      xp: 0,
      edits: {
        stats: {},
        senses: [],
        weapons: [],
        languages: [],
        skillOverrides: {},
      },
      xpLog: [],
      senses: null,
      pathwayWebId: crypto.randomUUID(),
    },
    prepared_override: {},
  };
}

/**
 * URL-safe slug of a character name. Lowercased, non-word chars collapsed to
 * hyphens, leading/trailing hyphens stripped, capped at 64 chars.
 */
function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^\w\s-]+/g, '-')
    .replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return (slug || 'character').slice(0, 64);
}

/** Map a file's MIME type to a filesystem-friendly extension. */
function extensionFor(file: File): string {
  switch (file.type) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    default: {
      const fromName = file.name.split('.').pop();
      return fromName && fromName.length <= 5 ? fromName.toLowerCase() : 'img';
    }
  }
}
