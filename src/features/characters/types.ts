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
  };
  [key: string]: unknown;
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
  'id' | 'char_key' | 'name' | 'source' | 'current_hp' | 'hero_points' | 'experience' | 'updated_at'
>;
