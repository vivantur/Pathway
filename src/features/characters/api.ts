import { requireSupabase } from '@/lib/supabase';
import type { PathbuilderBuild } from './pathbuilder';
import { maxHp } from './pathbuilder';
import { preferRemaster } from './pf2eData/sourcePreference';
import type {
  AncestryRow,
  CharacterNoteEntry,
  CharacterOverlay,
  CharacterRow,
  CharacterSummary,
  ClassFeatureRow,
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
 * Write the FULL `overlay` blob for one owned character. The bot owns the
 * overlay's shape (xp log, counters, bot-side edits), so callers MUST do
 * read-modify-write — compute the new overlay from the current one and pass
 * the whole thing here — rather than replacing it wholesale. Used for
 * player-editable live counters that live in the overlay (focus points, etc.).
 */
export async function updateCharacterOverlay(input: {
  userId: string;
  charKey: string;
  overlay: CharacterOverlay;
}): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('characters')
    .update({ overlay: input.overlay, updated_at: new Date().toISOString() })
    .eq('user_id', input.userId)
    .eq('char_key', input.charKey);
  if (error) throw error;
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
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('characters')
    .select(FULL_COLUMNS)
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
 * silently creating a duplicate. RLS scopes to the current user so the
 * uniqueness only checks their own row set.
 */
export async function findCharacterByPathbuilderId(
  pathbuilderId: number,
): Promise<ExistingCharacterMatch | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('characters')
    .select('id, char_key, name, updated_at')
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
  pathbuilderId: number;
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
    pathbuilder_id: pathbuilderId,
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
