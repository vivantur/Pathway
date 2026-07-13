/**
 * Type schema for Pathway's PF2e dataset.
 *
 * This is the app-facing shape. The hand-authored seed in `data/seed/*.json`
 * conforms to it, and `scripts/ingest-pf2e.mjs` transforms the Foundry `pf2e`
 * packs into the same shape under `data/generated/`.
 */

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export const ABILITY_KEYS: readonly AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const ABILITY_NAMES: Record<AbilityKey, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

/** Proficiency rank: 0 untrained, 1 trained, 2 expert, 3 master, 4 legendary. */
export type ProficiencyRank = 0 | 1 | 2 | 3 | 4;

export type Size = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';

/**
 * A single ability boost slot:
 *  - a fixed ability (e.g. 'con')
 *  - 'free' — the player picks any ability
 *  - an array — a restricted choice among the listed abilities
 */
export type Boost = AbilityKey | 'free' | AbilityKey[];

export interface Heritage {
  id: string;
  /** Empty for versatile heritages (they belong to no single ancestry). */
  ancestryId: string;
  name: string;
  description: string;
  source: string;
  /** True for versatile heritages (Nephilim, Dhampir, …) selectable by any ancestry. */
  versatile?: boolean;
  /** Optional extra languages, senses, etc. — free text summaries for now. */
  grants?: string[];
}

export interface Ancestry {
  id: string;
  name: string;
  hp: number;
  size: Size;
  speed: number;
  /** Ability boosts granted at character creation. */
  boosts: Boost[];
  /** Ability flaws (fixed). */
  flaws: AbilityKey[];
  /** Languages always known. */
  languages: string[];
  /** Number of additional languages the player may choose (Int-gated at build). */
  bonusLanguages: number;
  /** Pool the bonus languages are chosen from. */
  bonusLanguageChoices: string[];
  traits: string[];
  heritages: Heritage[];
  source: string;
  description: string;
}

export interface Background {
  id: string;
  name: string;
  /** Usually two boosts; the first commonly a restricted choice, the second free. */
  boosts: Boost[];
  /** Skill this background trains. */
  trainedSkill: string;
  /** Lore skill this background trains (free text). */
  loreSkill: string;
  /** Skill feat granted, if any (feat id). */
  skillFeat?: string;
  source: string;
  description: string;
}

export interface ClassInitialProficiencies {
  perception: ProficiencyRank;
  fortitude: ProficiencyRank;
  reflex: ProficiencyRank;
  will: ProficiencyRank;
  classDC: ProficiencyRank;
  /** Number of skills the class trains, on top of background/Int. */
  trainedSkillCount: number;
  /** Skills always trained by the class (skill ids). */
  trainedSkills: string[];
  attacks: {
    unarmed: ProficiencyRank;
    simple: ProficiencyRank;
    martial: ProficiencyRank;
    advanced: ProficiencyRank;
    unarmored: ProficiencyRank;
  };
  defenses: {
    unarmored: ProficiencyRank;
    light: ProficiencyRank;
    medium: ProficiencyRank;
    heavy: ProficiencyRank;
  };
}

export interface Subclass {
  id: string;
  name: string;
  description: string;
}

export interface CharacterClass {
  id: string;
  name: string;
  /** Key ability options — player picks one when more than one is offered. */
  keyAbility: AbilityKey[];
  /** Hit points granted per level (before Con). */
  hp: number;
  initialProficiencies: ClassInitialProficiencies;
  /** e.g. "Doctrine", "Muse", "Hunter's Edge" — the level-1 subclass choice label. */
  subclassLabel?: string;
  subclasses?: Subclass[];
  /** Named class features granted automatically at level 1. */
  features?: string[];
  source: string;
  description: string;
}

export interface Skill {
  id: string;
  name: string;
  ability: AbilityKey;
}

export type FeatType = 'ancestry' | 'class' | 'skill' | 'general' | 'archetype';

export interface Feat {
  id: string;
  name: string;
  level: number;
  type: FeatType;
  traits: string[];
  /** Free-text prerequisites for display; enforcement is best-effort. */
  prerequisites?: string;
  /** For class feats: which class id(s) can take it. */
  classIds?: string[];
  /** For ancestry feats: which ancestry id. */
  ancestryId?: string;
  /** Optional theme tags for filtering (curated or derived). */
  tags?: string[];
  /** Action cost: '1' | '2' | '3' | 'reaction' | 'free'; absent for passive feats. */
  actionCost?: string;
  /** Rarity when not common ('uncommon' | 'rare' | 'unique'). */
  rarity?: string;
  /**
   * Foundry machine-readable effect rules (FlatModifier, ChoiceSet, GrantItem, …).
   * DORMANT — carried by the ingest for the future effects engine; nothing reads
   * it yet. Deliberately untyped until that engine defines the shape it consumes.
   */
  rules?: unknown[];
  /** Content Foundry doesn't (yet) ship in Remaster form; kept so its id resolves. */
  legacy?: boolean;
  source: string;
  description: string;
}

/** A curated beginner suggestion: a feat id plus a one-line plain-language reason. */
export interface Recommendation {
  featId: string;
  reason: string;
}

/** Beginner feat recommendations, keyed by class id and by ancestry id. */
export interface RecommendationSet {
  class: Record<string, Recommendation[]>;
  ancestry: Record<string, Recommendation[]>;
}

export type WeaponCategory = 'unarmed' | 'simple' | 'martial' | 'advanced';
export type ArmorCategory = 'unarmored' | 'light' | 'medium' | 'heavy';
export type DamageType = 'B' | 'P' | 'S';

export interface Weapon {
  id: string;
  kind: 'weapon';
  name: string;
  category: WeaponCategory;
  group: string;
  damageDie: string; // e.g. 'd6'
  damageType: DamageType;
  hands: string; // '1', '2', '1+'
  ranged: boolean;
  range?: number; // feet, for ranged/thrown
  traits: string[];
  bulk: string; // 'L', '1', '2', '—'
  price: number; // in gp
  source: string;
}

export interface Armor {
  id: string;
  kind: 'armor';
  name: string;
  category: ArmorCategory;
  acBonus: number;
  dexCap: number | null; // null = no cap
  strength: number; // required Str score to avoid penalties
  checkPenalty: number;
  speedPenalty: number; // feet
  group: string;
  traits: string[];
  bulk: string;
  price: number;
  source: string;
}

export interface Shield {
  id: string;
  kind: 'shield';
  name: string;
  acBonus: number;
  hardness: number;
  hp: number;
  speedPenalty: number;
  bulk: string;
  price: number;
  source: string;
}

export interface Gear {
  id: string;
  kind: 'gear';
  name: string;
  bulk: string;
  price: number;
  description: string;
  source: string;
}

export type Item = Weapon | Armor | Shield | Gear;

export interface Spell {
  id: string;
  name: string;
  /** Spell rank (1–10); 0-rank cantrips carry the cantrip trait. */
  rank: number;
  /** Magic traditions that have this spell (arcane/divine/occult/primal). */
  traditions: string[];
  traits: string[];
  /** Casting time, e.g. "2" (actions), "1", "reaction". */
  cast: string;
  /** Normalized action cost mirroring `cast` (kept distinct for future display). */
  actionCost?: string;
  /** Range, e.g. "30 feet", "touch", "planar". */
  range?: string;
  /** Area, e.g. "20-foot burst", "60-foot cone". */
  area?: string;
  /** Target text, e.g. "1 creature". */
  targets?: string;
  /** Duration, e.g. "1 minute", "sustained". */
  duration?: string;
  /** Defense the target rolls, e.g. "basic Reflex", "Will". */
  defense?: string;
  /** Structured heightening (Foundry shape: interval / fixed levels). Untyped for now. */
  heightening?: unknown;
  /** Rarity when not common. */
  rarity?: string;
  /** Content Foundry doesn't (yet) ship in Remaster form; kept so its id resolves. */
  legacy?: boolean;
  source: string;
  description: string;
}

/**
 * Old content id → current id, for ids the Remaster corpus renamed or
 * consolidated (e.g. `evasiveness-rogue` → `evasiveness`). Lets saved characters
 * and curated recommendations built on the old ids keep resolving.
 */
export interface ContentAliases {
  feats: Record<string, string>;
  spells: Record<string, string>;
}

export interface Dataset {
  ancestries: Ancestry[];
  /** Versatile heritages (Nephilim, Dhampir, …) — selectable by any ancestry. */
  versatileHeritages: Heritage[];
  backgrounds: Background[];
  classes: CharacterClass[];
  skills: Skill[];
  feats: Feat[];
  items: Item[];
  spells: Spell[];
  /** Where this dataset came from — 'seed' or 'generated'. */
  provenance: 'seed' | 'generated';
  /** Content attribution (Paizo Community Use / ORC). */
  attribution: string;
}
