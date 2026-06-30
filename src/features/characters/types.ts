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

export interface CharacterRow {
  id: string;
  user_id: string;
  char_key: string;
  name: string;
  source: string | null;
  pathbuilder_data: PathbuilderData | null;
  current_hp: number | null;
  hero_points: number | null;
  dying: number | null;
  wounded: number | null;
  experience: number | null;
  overlay: Record<string, unknown> | null;
  updated_at: string | null;
}

/** A lightweight projection for list/vault views. */
export type CharacterSummary = Pick<
  CharacterRow,
  'id' | 'char_key' | 'name' | 'source' | 'current_hp' | 'hero_points' | 'experience' | 'updated_at'
>;
