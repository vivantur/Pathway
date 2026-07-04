import type { AbilityKey } from '@/features/builder/data';

/**
 * The player's raw choices. Everything derived (final scores, HP, AC, saves)
 * is computed from this by `rules.ts` — this state stays minimal and is what we
 * serialize/deserialize.
 */
export interface BuilderState {
  name: string;
  level: number; // fixed at 1 for this milestone

  /** Optional character portrait, stored as a small data URL (see lib/image.ts). */
  portrait?: string;

  ancestryId?: string;
  heritageId?: string;
  backgroundId?: string;
  classId?: string;

  /** Chosen key ability when the class offers more than one. */
  keyAbility?: AbilityKey;
  /** Chosen subclass (doctrine/muse/order/etc.) id. */
  subclassId?: string;

  /** One choice per ancestry boost slot that is 'free' or a restricted set. Index-aligned to the free/choice slots. */
  ancestryBoostChoices: (AbilityKey | null)[];
  /** One choice per background boost slot that is 'free' or restricted. */
  backgroundBoostChoices: (AbilityKey | null)[];
  /** The four free attribute boosts everyone gets — must target four different abilities. */
  freeBoosts: (AbilityKey | null)[];

  /** Skills the player chose to train (class free picks + Intelligence bonus). */
  skillChoices: string[];

  ancestryFeatId?: string;
  classFeatId?: string;

  /** Additional languages chosen (Int-gated + ancestry bonus). */
  languageChoices: string[];

  /**
   * Per-level choices for levels 2–20 (level 1 lives in the fields above).
   * Keyed by level number. A character can be a partial build: only levels up
   * to `level` need to be filled in.
   */
  progression: Record<number, LevelGains>;

  /** Character-scoped option toggles (variant rules etc.); see features/options. */
  options?: Record<string, boolean>;

  /** Owned items (by dataset item id) with quantity and equipped state. */
  inventory: InventoryEntry[];
  /** Coin on hand, in gold pieces (gp). */
  money: number;

  /** Chosen spells for caster classes (dataset spell ids). */
  spellcasting: {
    cantrips: string[];
    spellsByRank: Record<number, string[]>;
    /** Chosen focus spells (dataset spell ids); available to any focus-using class. */
    focusSpells: string[];
    /** Chosen focus cantrips (dataset spell ids). */
    focusCantrips: string[];
    /**
     * For classes whose focus tradition is a player choice (monk: divine/occult;
     * summoner: the eidolon's tradition). Fixed-tradition classes ignore this.
     */
    focusTradition?: string;
  };
}

export interface InventoryEntry {
  itemId: string;
  qty: number;
  /** For armor/shield/weapons: whether it's currently worn/wielded. */
  equipped?: boolean;
}

/** The choices a character makes at a single level above 1. */
export interface LevelGains {
  classFeatId?: string;
  ancestryFeatId?: string;
  skillFeatId?: string;
  generalFeatId?: string;
  /** Free Archetype variant: an archetype feat this level. */
  archetypeFeatId?: string;
  /** Skill ids whose proficiency was increased this level. */
  skillIncreases: string[];
  /** Ability boosts granted this level (4 at 5/10/15/20, or per gradual-boost rules). */
  boosts: (AbilityKey | null)[];
}

export function emptyLevelGains(): LevelGains {
  return { skillIncreases: [], boosts: [] };
}

export function emptyBuilderState(): BuilderState {
  return {
    name: '',
    level: 1,
    ancestryBoostChoices: [],
    backgroundBoostChoices: [],
    freeBoosts: [null, null, null, null],
    skillChoices: [],
    languageChoices: [],
    progression: {},
    inventory: [],
    money: 15,
    spellcasting: { cantrips: [], spellsByRank: {}, focusSpells: [], focusCantrips: [] },
  };
}

export type StepId =
  | 'ancestry'
  | 'heritage'
  | 'background'
  | 'class'
  | 'abilities'
  | 'skills'
  | 'feats'
  | 'advancement'
  | 'spells'
  | 'equipment'
  | 'review';
