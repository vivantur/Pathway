/**
 * The `characters` table shape — reverse-engineered from the live bot and
 * documented in docs/architecture/data-model.md §3.
 *
 * CRITICAL split (web-bot-sync.md §3): the *sheet build* lives in
 * `pathbuilder_data`; *live play state* (HP, hero points, dying/wounded, XP,
 * overlay) lives in dedicated columns — NOT inside the build JSON. The website
 * must honor that split on every write or it will fight the bot.
 *
 * Phase W0 only reads, so these types intentionally describe the read shape.
 * Write payloads (with `overlay` read-modify-write + `updated_at` stamping)
 * come in Phase W2.
 */

/** The Pathbuilder build JSON. May be the build object directly or `{ build }`. */
export type PathbuilderData =
  | { build: Record<string, unknown>; [key: string]: unknown }
  | Record<string, unknown>;

/**
 * Bot-side overrides stored in `characters.overlay`. Read-modify-write only —
 * the bot owns the shape, so we consume selectively and preserve everything
 * else. The two branches we actually render from today are `daily.*` (live
 * counters) and `pathway_bot_state.edits.*` (canonical player-facing edits
 * that supersede the Pathbuilder JSON — languages, senses, weapons, etc.).
 */
export interface CharacterOverlay {
  daily?: {
    hero_points?: number;
    focus_spent?: number;
    slots_used?: Record<string, unknown>;
  };
  counters?: Record<string, {
    max?: number;
    current?: number;
    label?: string | null;
    display?: string;
    reset?: string;
  }>;
  pathway_bot_state?: {
    edits?: {
      senses?: string[];
      languages?: string[];
      background?: string;
      weapons?: Array<{
        name?: string;
        display?: string;
        die?: string;
        attack?: number;
        damageBonus?: number;
        damageType?: string;
        traits?: string[];
        runes?: string[];
        potencyRune?: number;
        strikingRune?: string;
      }>;
      skillOverrides?: Record<string, { rank?: number }>;
      stats?: Record<string, unknown>;
    };
    xpLog?: Array<XpLogEntry>;
    xp?: number;
    senses?: string[] | null;
    pathwayWebId?: string;
  };
  [key: string]: unknown;
}

/** One entry in `overlay.pathway_bot_state.xpLog` — bot-side XP award history. */
export interface XpLogEntry {
  at?: string;
  amount?: number;
  reason?: string;
  oldXp?: number;
  newXp?: number;
  awardedBy?: string;
}

/**
 * One row from `public.ancestries`. Field names are our best guess from PF2e
 * convention + Pathbuilder's shape; unknown columns are preserved on the row
 * via the index signature so re-render works even when this type is wrong
 * about a specific field name.
 */
export interface AncestryRow {
  id: string;
  name: string;
  description?: string | null;
  hp?: number | null;
  size?: string | number | null;
  speed?: number | null;
  ability_boosts?: string[] | null;
  ability_flaws?: string[] | null;
  languages?: string[] | null;
  traits?: string[] | null;
  rarity?: string | null;
  source?: string | null;
  aon_id?: string | null;
  aon_url?: string | null;
  [key: string]: unknown;
}

/** One row from `public.heritages`. */
export interface HeritageRow {
  id: string;
  name: string;
  description?: string | null;
  ancestry_id?: string | null;
  ancestry_name?: string | null;
  traits?: string[] | null;
  rarity?: string | null;
  source?: string | null;
  aon_url?: string | null;
  [key: string]: unknown;
}

/**
 * One row from `public.gamedata` where `category = 'classes'`. The rich class
 * shape (HP per level, key ability, initial proficiencies, etc.) lives in the
 * `data` JSONB. We only type the wrapper here — the `data` payload is read
 * defensively at render time because Pathbuilder / Foundry / AoN each store
 * class shape slightly differently.
 */
export interface ClassGamedata {
  id: number;
  category: string;
  slug: string;
  name: string;
  data: Record<string, unknown>;
  updated_at?: string | null;
}

/** One row from `public.class_features` (schema confirmed by audit). */
export interface ClassFeatureRow {
  id: string;
  aon_id?: string | null;
  aon_url?: string | null;
  character_class_id?: string | null;
  archetype_id?: string | null;
  name: string;
  level?: number | null;
  description?: string | null;
  traits?: string[] | null;
  is_choice?: boolean | null;
  rarity?: string | null;
  source?: string | null;
  is_official?: boolean | null;
  class_feature_metadata?: Record<string, unknown> | null;
}

/**
 * One row from `public.spells`. We don't have a schema audit for this table
 * yet, so field names follow standard PF2e conventions; unknown fields are
 * preserved via the index signature and any missing column just renders as
 * "—" in the UI without breaking the layout.
 */
export interface SpellRow {
  id: string;
  name: string;
  description?: string | null;
  level?: number | null;
  spell_level?: number | null;
  rank?: number | null;
  traits?: string[] | null;
  actions?: string | null;
  action_cost?: string | null;
  range?: string | null;
  area?: string | null;
  targets?: string | null;
  duration?: string | null;
  saving_throw?: string | null;
  save?: string | null;
  heightened?: string | null;
  rarity?: string | null;
  source?: string | null;
  aon_id?: string | null;
  aon_url?: string | null;
  spell_metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
}

/** One row from `public.feats` — full rich shape (verified from the audit). */
export interface FeatRow {
  id: string;
  name: string;
  description?: string | null;
  feat_type?: string | null;
  level?: number | null;
  traits?: string[] | null;
  prerequisites?: string | null;
  action_cost?: string | null;
  trigger?: string | null;
  rarity?: string | null;
  source?: string | null;
  aon_id?: string | null;
  aon_url?: string | null;
}

/** Per-user, per-character note list (character_notes table). */
export interface CharacterNoteEntry {
  id: number;
  text?: string;
  title?: string;
  body?: string;
  [key: string]: unknown;
}

export interface CharacterRow {
  id: string;
  user_id: string;
  char_key: string;
  name: string;
  source: string | null;
  pathbuilder_data: PathbuilderData | null;
  pathbuilder_id: number | null;
  ancestry_name: string | null;
  heritage_name: string | null;
  class_name: string | null;
  background_name: string | null;
  level: number | null;
  current_hp: number | null;
  hero_points: number | null;
  dying: number | null;
  wounded: number | null;
  experience: number | null;
  currency: { pp?: number; gp?: number; sp?: number; cp?: number } | null;
  overlay: CharacterOverlay | null;
  status: string | null;
  notes: string | null;
  art: string | null;
  is_public: boolean | null;
  public_share_id: string | null;
  updated_at: string | null;
}

/** A lightweight projection for list/vault views. */
export type CharacterSummary = Pick<
  CharacterRow,
  'id' | 'char_key' | 'name' | 'source' | 'current_hp' | 'hero_points' | 'experience' | 'updated_at' | 'art' | 'level' | 'ancestry_name' | 'class_name'
>;
