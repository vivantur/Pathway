import type { AbilityKey } from '@/features/builder/data';
import type {
  CompanionCustomAbility,
  CompanionCustomAttack,
  CompanionOverrides,
} from '@/features/companions/types';

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
  /**
   * Chosen weapon group for group-scoped proficiency features (the fighter's
   * Weapon Mastery / Weapon Legend). Ignored by classes without such a choice.
   */
  weaponGroup?: string;
  /**
   * Monk Path to Perfection save choices (7th/11th/15th). `third` must repeat
   * `first` or `second` (it raises one of them to legendary).
   */
  monkPaths?: {
    first?: 'fortitude' | 'reflex' | 'will';
    second?: 'fortitude' | 'reflex' | 'will';
    third?: 'fortitude' | 'reflex' | 'will';
  };

  /** One choice per ancestry boost slot that is 'free' or a restricted set. Index-aligned to the free/choice slots. */
  ancestryBoostChoices: (AbilityKey | null)[];
  /** One choice per background boost slot that is 'free' or restricted. */
  backgroundBoostChoices: (AbilityKey | null)[];
  /** The four free attribute boosts everyone gets — must target four different abilities. */
  freeBoosts: (AbilityKey | null)[];

  /** Skills the player chose to train (class free picks + Intelligence bonus). */
  skillChoices: string[];

  /**
   * ChoiceSet selections for feats that ask the player to pick (Canny Acumen's
   * save/Perception, Natural Skill's two skills, …). Keyed by feat id → a map of
   * the feat's ChoiceSet flag name → the chosen value (a rank target path for
   * whole-path choices, or a skill slug for embedded choices). Read by
   * `characterEffects` to resolve `{item|flags.system.rulesSelections.<flag>}`.
   */
  featChoices: Record<string, Record<string, string>>;

  ancestryFeatId?: string;
  /** Second level-1 ancestry feat granted by the Ancestry Paragon variant. */
  ancestryParagonFeatId?: string;
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

  /**
   * Innate spells the character has from ancestry, heritage, feats, or magic
   * items. These aren't tied to a spellcasting class, so any character can have
   * them; the player records what their build grants (dataset spell ids).
   */
  innateSpells: InnateSpellEntry[];

  /**
   * Companions drafted during creation, before the character exists in the
   * vault. Companions are stored per char_key, so a brand-new character can't
   * write them yet — drafts buffer here and are created for real right after
   * the first "Save to Vault" (see useSaveBuild), then this list is cleared.
   */
  companionDrafts: CompanionDraft[];
}

/** A companion drafted in the builder (mirrors companions/api SaveCompanionInput). */
export interface CompanionDraft {
  kind: 'animal' | 'mount' | 'familiar' | 'eidolon' | 'custom';
  displayName: string;
  baseType: string;
  form: 'young' | 'mature' | 'nimble' | 'savage';
  notes?: string | null;
  familiarAbilities?: string[];
  eidolonType?: string;
  eidolonBuild?: number;
  eidolonPrimaryName?: string;
  eidolonPrimaryDie?: string;
  custom?: Record<string, unknown>;
  overrides?: CompanionOverrides;
  skills?: Record<string, number>;
  customAbilities?: CompanionCustomAbility[];
  customAttacks?: CompanionCustomAttack[];
}

export type SpellTradition = 'arcane' | 'divine' | 'occult' | 'primal';

export interface InnateSpellEntry {
  spellId: string;
  tradition: SpellTradition;
  /** Times per day the innate spell can be cast (cantrips are effectively at-will). */
  perDay: number;
}

export interface InventoryEntry {
  itemId: string;
  qty: number;
  /** For armor/shield/weapons: whether it's currently worn/wielded. */
  equipped?: boolean;
  /**
   * Fundamental runes etched on this item. Weapons: potency (+1..+3 to attack)
   * and striking (1..3 = striking/greater/major → 2..4 damage dice). Armor:
   * potency (+1..+3 AC) and resilient (+1..+3 saves). Ignored when the
   * Automatic Bonus Progression variant is on (ABP replaces these runes).
   */
  runes?: { potency?: number; striking?: number; resilient?: number };
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
    featChoices: {},
    languageChoices: [],
    progression: {},
    inventory: [],
    money: 15,
    spellcasting: { cantrips: [], spellsByRank: {}, focusSpells: [], focusCantrips: [] },
    innateSpells: [],
    companionDrafts: [],
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
  | 'companions'
  | 'review';
